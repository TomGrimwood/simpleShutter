use axum::{
    extract::{State, Json as AxumJson},
    response::{Html, Sse, sse::Event as SseEvent}, // Removed IntoResponse
    routing::{get, post},
    Router,
};
use futures_util::stream::{Stream}; // Removed StreamExt
use log::{debug, error, info, warn, LevelFilter};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    convert::Infallible,
    net::SocketAddr,
    sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    sync::{broadcast, oneshot}, // Removed mpsc
    time::interval,
};
use tokio_serial::{SerialPortBuilderExt}; // Removed SerialStream

// --- Configuration Constants ---
const DISTANCE_S1_S2_MM: f64 = 20.0;
const DISTANCE_S2_S3_MM: f64 = 20.0;
const ESP32_HEARTBEAT_TIMEOUT_SECONDS: u64 = 30;
const SERIAL_BAUD_RATE: u32 = 115200;
// const MAX_SSE_CLIENT_QUEUE: usize = 10; // Not directly used, broadcast channel size is different

// --- HTML Content ---
const INDEX_HTML: &str = include_str!("../static/index.html"); // Assumes index.html is in static/ folder

// --- Structs for Data Handling ---

#[derive(Serialize, Clone, Debug, Default)]
struct RawTimesUs {
    s1_open: Option<u64>, s1_close: Option<u64>,
    s2_open: Option<u64>, s2_close: Option<u64>,
    s3_open: Option<u64>, s3_close: Option<u64>,
}

#[derive(Serialize, Clone, Debug, Default)]
struct SensorValues<T> {
    s1: T,
    s2: T,
    s3: T,
}

#[derive(Serialize, Clone, Debug, Default)]
struct CurtainTravelTimesMs {
    s1_to_s2: Option<f64>,
    s2_to_s3: Option<f64>,
    s1_to_s3_total: Option<f64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
enum SlitWidth {
    NotApplicable, // For "N/A"
    Value(f64),
}

impl Default for SlitWidth {
    fn default() -> Self { SlitWidth::NotApplicable }
}


#[derive(Serialize, Clone, Debug, Default)]
struct ShutterMetrics {
    measurement_mode: String,
    raw_times_us: RawTimesUs,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    errors: Vec<String>,
    exposure_times_us: SensorValues<Option<u64>>,
    exposure_times_ms: SensorValues<Option<f64>>,
    exposure_times_s: SensorValues<Option<f64>>,
    shutter_speeds_hz_equivalent: SensorValues<Option<f64>>, // f64::INFINITY for "inf"
    curtain1_travel_times_ms: CurtainTravelTimesMs,
    curtain2_travel_times_ms: CurtainTravelTimesMs,
    open_time_duration_ms: Option<f64>,
    average_slit_width_mm: Option<SlitWidth>,
    exposure_consistency_s_min_max_diff: Option<f64>,
    exposure_variation_percent_from_avg: Option<f64>,
}

#[derive(Deserialize, Debug)]
struct Esp32ShutterDataPayload {
    mode: Option<String>,
    s1_open: Option<serde_json::Value>,
    s1_close: Option<serde_json::Value>,
    s2_open: Option<serde_json::Value>,
    s2_close: Option<serde_json::Value>,
    s3_open: Option<serde_json::Value>,
    s3_close: Option<serde_json::Value>,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Esp32Message {
    Heartbeat,
    ShutterData(Esp32ShutterDataPayload),
    Log { message: String },
    Info { message: String },
    Debug { message: String },
    Warning { message: String },
    Error { message: String },
    Critical { message: String },
}

#[derive(Serialize, Clone, Debug)]
struct Esp32ConnectionStatus {
    online: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_seen_timestamp: Option<u64>, // Unix timestamp seconds
    status_text: String,
    current_port: Option<String>,
    active_port: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
struct ServerEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    shutter_metrics: Option<ShutterMetrics>,
    esp32_connection: Esp32ConnectionStatus,
}

// --- Application State ---
struct AppState {
    // For broadcasting shutter metrics to all SSE clients
    metrics_tx: broadcast::Sender<ShutterMetrics>,
    
    // Serial port management
    target_serial_port: Mutex<Option<String>>,
    current_listener_port: Mutex<Option<String>>, // Port the active listener is trying/using
    serial_connection_active: AtomicBool,
    last_esp32_heartbeat_time: Mutex<Option<SystemTime>>,
    
    // To control the serial listener task
    serial_stop_tx: Mutex<Option<oneshot::Sender<()>>>,
}

impl AppState {
    fn new() -> Arc<Self> {
        let (metrics_tx, _) = broadcast::channel(32); // Channel for ShutterMetrics
        Arc::new(Self {
            metrics_tx,
            target_serial_port: Mutex::new(None),
            current_listener_port: Mutex::new(None),
            serial_connection_active: AtomicBool::new(false),
            last_esp32_heartbeat_time: Mutex::new(None),
            serial_stop_tx: Mutex::new(None),
        })
    }
}

type SharedAppState = Arc<AppState>;

// --- Helper Functions ---
fn is_valid_time_value(t_us: u64) -> bool {
    t_us > 0
}

fn parse_timestamp_from_value(val_opt: Option<&serde_json::Value>) -> u64 {
    val_opt.map_or(0, |v| {
        if v.is_u64() {
            v.as_u64().unwrap_or(0)
        } else if v.is_f64() {
            v.as_f64().map(|f| f.trunc() as u64).unwrap_or(0)
        } else if v.is_string() {
            v.as_str().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0)
        } else {
            0
        }
    })
}

// --- Core Calculation Logic ---
#[allow(clippy::too_many_arguments, clippy::cognitive_complexity)]
fn calculate_shutter_data(
    s1_o: u64, s1_c: u64, s2_o: u64, s2_c: u64, s3_o: u64, s3_c: u64, mode_str: &str
) -> ShutterMetrics {
    let mut results = ShutterMetrics::default();
    results.measurement_mode = mode_str.to_uppercase();

    results.raw_times_us = RawTimesUs {
        s1_open: Some(s1_o), s1_close: Some(s1_c),
        s2_open: Some(s2_o), s2_close: Some(s2_c),
        s3_open: Some(s3_o), s3_close: Some(s3_c),
    };

    let mut errors_set = HashSet::new();

    #[derive(PartialEq, Eq, Hash, Clone, Copy, Debug)] // Added Debug here
    enum SensorLabel { S1, S2, S3 }
    use SensorLabel::*;

    let sensor_data_map: [(SensorLabel, (u64, u64)); 3] = [
        (S1, (s1_o, s1_c)), (S2, (s2_o, s2_c)), (S3, (s3_o, s3_c))
    ];
    
    let active_sensors_for_mode: Vec<SensorLabel> = match results.measurement_mode.as_str() {
        "ALL" => vec![S1, S2, S3],
        "OUTER" => vec![S1, S3],
        "INNER" => vec![S2],
        _ => vec![S1, S2, S3], // Default, should be caught earlier
    };

    for &sensor_label_enum in &[S1, S2, S3] {
        let (o, c) = sensor_data_map.iter().find(|(lbl, _)| *lbl == sensor_label_enum).unwrap().1;
        let is_active = active_sensors_for_mode.contains(&sensor_label_enum);

        let mut exp_us = None;
        let mut exp_ms = None;
        let mut exp_s_val = None;
        let mut speed_hz = None;

        if is_active {
            if is_valid_time_value(o) && is_valid_time_value(c) && c > o {
                let us = c - o;
                exp_us = Some(us);
                exp_ms = Some(us as f64 / 1000.0);
                let s = us as f64 / 1_000_000.0;
                exp_s_val = Some(s);
                speed_hz = if s > 0.0 { Some(1.0 / s) } else { Some(f64::INFINITY) };
            } else {
                // Python: if not (o == 0 and c == 0): error
                if !(o == 0 && c == 0) {
                    errors_set.insert(format!("Invalid open/close times for active sensor {:?}: o={}, c={}", sensor_label_enum, o, c));
                }
            }
        }
        
        match sensor_label_enum {
            S1 => {
                results.exposure_times_us.s1 = exp_us;
                results.exposure_times_ms.s1 = exp_ms;
                results.exposure_times_s.s1 = exp_s_val;
                results.shutter_speeds_hz_equivalent.s1 = speed_hz;
            }
            S2 => {
                results.exposure_times_us.s2 = exp_us;
                results.exposure_times_ms.s2 = exp_ms;
                results.exposure_times_s.s2 = exp_s_val;
                results.shutter_speeds_hz_equivalent.s2 = speed_hz;
            }
            S3 => {
                results.exposure_times_us.s3 = exp_us;
                results.exposure_times_ms.s3 = exp_ms;
                results.exposure_times_s.s3 = exp_s_val;
                results.shutter_speeds_hz_equivalent.s3 = speed_hz;
            }
        }
    }
    
    // Curtain travel times
    if mode_str == "ALL" {
        if is_valid_time_value(s1_o) && is_valid_time_value(s2_o) && s2_o > s1_o { results.curtain1_travel_times_ms.s1_to_s2 = Some((s2_o - s1_o) as f64 / 1000.0); } 
        else { errors_set.insert("C1 S1->S2: Invalid S1/S2 open times.".to_string()); }
        if is_valid_time_value(s2_o) && is_valid_time_value(s3_o) && s3_o > s2_o { results.curtain1_travel_times_ms.s2_to_s3 = Some((s3_o - s2_o) as f64 / 1000.0); }
        else { errors_set.insert("C1 S2->S3: Invalid S2/S3 open times.".to_string()); }
        if is_valid_time_value(s1_o) && is_valid_time_value(s3_o) && s3_o > s1_o { results.curtain1_travel_times_ms.s1_to_s3_total = Some((s3_o - s1_o) as f64 / 1000.0); }

        if is_valid_time_value(s1_c) && is_valid_time_value(s2_c) && s2_c > s1_c { results.curtain2_travel_times_ms.s1_to_s2 = Some((s2_c - s1_c) as f64 / 1000.0); }
        else { errors_set.insert("C2 S1->S2: Invalid S1/S2 close times.".to_string()); }
        if is_valid_time_value(s2_c) && is_valid_time_value(s3_c) && s3_c > s2_c { results.curtain2_travel_times_ms.s2_to_s3 = Some((s3_c - s2_c) as f64 / 1000.0); }
        else { errors_set.insert("C2 S2->S3: Invalid S2/S3 close times.".to_string()); }
        if is_valid_time_value(s1_c) && is_valid_time_value(s3_c) && s3_c > s1_c { results.curtain2_travel_times_ms.s1_to_s3_total = Some((s3_c - s1_c) as f64 / 1000.0); }
    
    } else if mode_str == "OUTER" {
        if is_valid_time_value(s1_o) && is_valid_time_value(s3_o) && s3_o > s1_o { results.curtain1_travel_times_ms.s1_to_s3_total = Some((s3_o - s1_o) as f64 / 1000.0); }
        else { errors_set.insert("C1 S1->S3 (Outer): Invalid S1/S3 open times.".to_string()); }
        if is_valid_time_value(s1_c) && is_valid_time_value(s3_c) && s3_c > s1_c { results.curtain2_travel_times_ms.s1_to_s3_total = Some((s3_c - s1_c) as f64 / 1000.0); }
        else { errors_set.insert("C2 S1->S3 (Outer): Invalid S1/S3 close times.".to_string()); }
    }

    // Open time duration
    if mode_str == "ALL" || mode_str == "OUTER" {
        if is_valid_time_value(s3_o) && is_valid_time_value(s1_c) {
            if s1_c > s3_o { results.open_time_duration_ms = Some((s1_c - s3_o) as f64 / 1000.0); }
            else { results.open_time_duration_ms = Some(0.0); }
        } else { errors_set.insert("Cannot calculate shutter fully open duration: S1_close or S3_open missing/invalid for mode.".to_string());}
    }

    // Average slit width
    let mut avg_c1_speed_mps = None;
    if let Some(c1_total_travel_ms) = results.curtain1_travel_times_ms.s1_to_s3_total {
        if c1_total_travel_ms > 0.0 {
            let dist_s1_s3_m = (DISTANCE_S1_S2_MM + DISTANCE_S2_S3_MM) / 1000.0;
            if dist_s1_s3_m > 0.0 {
                let time_s1_s3_open_s = c1_total_travel_ms / 1000.0;
                avg_c1_speed_mps = Some(dist_s1_s3_m / time_s1_s3_open_s);
            } else { errors_set.insert("Sensor distance S1-S3 is zero, cannot calculate speed.".to_string()); }
        }
    } else if mode_str == "ALL" || mode_str == "OUTER" {
        errors_set.insert("Cannot calculate C1 avg speed: S1-S3 travel time unavailable.".to_string());
    }
    
    let mut valid_exposures_s_list_for_slit = Vec::new();
    for label in &active_sensors_for_mode {
        let exp_s_opt = match label {
            S1 => results.exposure_times_s.s1,
            S2 => results.exposure_times_s.s2,
            S3 => results.exposure_times_s.s3,
        };
        if let Some(exp_s) = exp_s_opt {
            if exp_s > 0.0 { valid_exposures_s_list_for_slit.push(exp_s); }
        }
    }
    let mut avg_exposure_s_for_slit = None;
    if !valid_exposures_s_list_for_slit.is_empty() {
        avg_exposure_s_for_slit = Some(valid_exposures_s_list_for_slit.iter().sum::<f64>() / valid_exposures_s_list_for_slit.len() as f64);
    }

    if mode_str == "ALL" || mode_str == "OUTER" {
        if results.open_time_duration_ms.map_or(false, |d| d > 0.0) {
            results.average_slit_width_mm = Some(SlitWidth::NotApplicable);
        } else if let (Some(speed), Some(avg_exp_s)) = (avg_c1_speed_mps, avg_exposure_s_for_slit) {
             if avg_exp_s > 0.0 {
                results.average_slit_width_mm = Some(SlitWidth::Value((speed * avg_exp_s * 1000.0 * 100.0).round() / 100.0 )); // round to 2 decimal
             } else {
                errors_set.insert("Slit width: Avg exposure time zero.".to_string());
             }
        } else {
            if avg_c1_speed_mps.is_none() { errors_set.insert("Slit width: Avg C1 speed unavailable.".to_string());}
            if avg_exposure_s_for_slit.is_none() { errors_set.insert("Slit width: Avg exposure time unavailable.".to_string());}
        }
    }

    // Exposure consistency
    let mut valid_exposures_for_consistency = Vec::new();
     for label in &active_sensors_for_mode {
        let exp_s_opt = match label {
            S1 => results.exposure_times_s.s1,
            S2 => results.exposure_times_s.s2,
            S3 => results.exposure_times_s.s3,
        };
        if let Some(exp_s) = exp_s_opt { valid_exposures_for_consistency.push(exp_s); }
    }

    if valid_exposures_for_consistency.len() > 1 {
        let min_val = valid_exposures_for_consistency.iter().fold(f64::INFINITY, |a, &b| a.min(b));
        let max_val = valid_exposures_for_consistency.iter().fold(f64::NEG_INFINITY, |a, &b| a.max(b));
        results.exposure_consistency_s_min_max_diff = Some(max_val - min_val); // Python rounds to 7, f64 has enough precision
        
        let sum_exp: f64 = valid_exposures_for_consistency.iter().sum();
        if sum_exp > 0.0 {
            let avg_exp_consistency = sum_exp / valid_exposures_for_consistency.len() as f64;
            if avg_exp_consistency > 0.0 {
                let max_dev_from_avg = valid_exposures_for_consistency.iter()
                    .map(|&exp| (exp - avg_exp_consistency).abs())
                    .fold(0.0, f64::max);
                results.exposure_variation_percent_from_avg = Some(((max_dev_from_avg / avg_exp_consistency) * 100.0 * 100.0).round() / 100.0); // round to 2 decimal
            }
        }
    } else if valid_exposures_for_consistency.len() == 1 && mode_str == "INNER" {
         results.exposure_variation_percent_from_avg = Some(0.0);
    }
    
    // Final error check for no valid raw timestamps
    let has_any_valid_exposure = active_sensors_for_mode.iter().any(|label| {
        match label {
            S1 => results.exposure_times_ms.s1.is_some(),
            S2 => results.exposure_times_ms.s2.is_some(),
            S3 => results.exposure_times_ms.s3.is_some(),
        }
    });
    if !has_any_valid_exposure && mode_str != "INNER" {
        let all_active_raw_invalid = active_sensors_for_mode.iter().all(|label| {
            let (o_raw, c_raw) = sensor_data_map.iter().find(|(lbl, _)| *lbl == *label).unwrap().1;
            !is_valid_time_value(o_raw) && !is_valid_time_value(c_raw)
        });
        if all_active_raw_invalid {
            errors_set.insert(format!("No valid raw timestamps received for any active sensor in mode {}.", mode_str));
        }
    }
    
    results.errors = errors_set.into_iter().collect();
    results
}


// --- Serial Listener Task ---
async fn serial_listener_task(
    app_state: SharedAppState,
    mut port_name: Option<String>, // Initial port to try
    mut stop_rx: oneshot::Receiver<()>,
) {
    info!("Serial listener task started.");

    loop {
        // Update current listener port in AppState
        {
            let mut current_port_guard = app_state.current_listener_port.lock().unwrap();
            *current_port_guard = port_name.clone();
        }

        if port_name.is_none() {
            info!("Serial listener: No port specified. Idling.");
            app_state.serial_connection_active.store(false, Ordering::SeqCst);
            // Wait for stop signal or port change (implicitly handled by task restart)
            tokio::select! {
                _ = &mut stop_rx => {
                    info!("Serial listener for NULL port stopping as signaled.");
                    break;
                }
                _ = tokio::time::sleep(Duration::from_secs(1)) => {} // Check periodically
            }
            // If we are here, it means sleep expired, re-check target_port from AppState on next loop
            // The actual restart for port change is handled by `start_serial_listener_task`
            // This loop iteration will effectively just re-evaluate port_name
            port_name = app_state.target_serial_port.lock().unwrap().clone(); 
            continue;
        }
        
        let current_port_str = port_name.as_ref().unwrap();
        info!("Serial listener: Attempting to connect to ESP32 on {} at {} baud...", current_port_str, SERIAL_BAUD_RATE);
        app_state.serial_connection_active.store(false, Ordering::SeqCst);

        match tokio_serial::new(current_port_str, SERIAL_BAUD_RATE).open_native_async() {
            Ok(serial_stream) => { // Removed mut here
                info!("Serial listener: Successfully connected to ESP32 on {}.", current_port_str);
                app_state.serial_connection_active.store(true, Ordering::SeqCst);
                *app_state.last_esp32_heartbeat_time.lock().unwrap() = Some(SystemTime::now());
                
                let mut reader = tokio::io::BufReader::new(serial_stream);
                let mut line_buf = String::new();

                loop { // Inner loop for reading from active connection
                    tokio::select! {
                        _ = &mut stop_rx => {
                            info!("Serial listener for {} stopping as signaled.", current_port_str);
                            app_state.serial_connection_active.store(false, Ordering::SeqCst);
                            // Clear current_listener_port only if this task was for the active target port
                            if app_state.current_listener_port.lock().unwrap().as_deref() == Some(current_port_str) {
                                 *app_state.current_listener_port.lock().unwrap() = None;
                            }
                            return; // Exit task completely
                        }
                        read_res = tokio::io::AsyncBufReadExt::read_line(&mut reader, &mut line_buf) => {
                            match read_res {
                                Ok(0) => { // EOF, port closed?
                                    warn!("Serial listener: Port {} closed (0 bytes read). Reconnecting...", current_port_str);
                                    break; // Break inner loop to attempt reconnect
                                }
                                Ok(_) => { // Got a line
                                    let line = line_buf.trim_end();
                                    debug!("Raw serial data from {}: {}", current_port_str, line);

                                    if !line.is_empty() {
                                        match serde_json::from_str::<Esp32Message>(line) {
                                            Ok(msg) => {
                                                *app_state.last_esp32_heartbeat_time.lock().unwrap() = Some(SystemTime::now());
                                                match msg {
                                                    Esp32Message::Heartbeat => {
                                                        info!("ESP32 Serial Heartbeat received on {}.", current_port_str);
                                                    }
                                                    Esp32Message::ShutterData(data) => {
                                                        info!("Received serial shutter data on {}: {:?}", current_port_str, data);
                                                        
                                                        let mode_str_upper = data.mode.unwrap_or_else(|| "ALL".to_string()).to_uppercase();
                                                        let final_mode_str = match mode_str_upper.as_str() {
                                                            "ALL" | "OUTER" | "INNER" => mode_str_upper,
                                                            _ => {
                                                                warn!("Invalid mode '{}' received from serial. Defaulting to ALL.", mode_str_upper);
                                                                "ALL".to_string()
                                                            }
                                                        };

                                                        let s1_o = parse_timestamp_from_value(data.s1_open.as_ref());
                                                        let s1_c = parse_timestamp_from_value(data.s1_close.as_ref());
                                                        let s2_o = parse_timestamp_from_value(data.s2_open.as_ref());
                                                        let s2_c = parse_timestamp_from_value(data.s2_close.as_ref());
                                                        let s3_o = parse_timestamp_from_value(data.s3_open.as_ref());
                                                        let s3_c = parse_timestamp_from_value(data.s3_close.as_ref());

                                                        let metrics = calculate_shutter_data(s1_o, s1_c, s2_o, s2_c, s3_o, s3_c, &final_mode_str);
                                                        if let Err(e) = app_state.metrics_tx.send(metrics) {
                                                            warn!("Failed to broadcast shutter metrics: {}. No active SSE receivers?", e);
                                                        }
                                                    }
                                                    Esp32Message::Log { message } => info!("ESP32 LOG ({}): {}", current_port_str, message),
                                                    Esp32Message::Info { message } => info!("ESP32 INFO ({}): {}", current_port_str, message),
                                                    Esp32Message::Debug { message } => debug!("ESP32 DEBUG ({}): {}", current_port_str, message),
                                                    Esp32Message::Warning { message } => warn!("ESP32 WARNING ({}): {}", current_port_str, message),
                                                    Esp32Message::Error { message } => error!("ESP32 ERROR ({}): {}", current_port_str, message),
                                                    Esp32Message::Critical { message } => error!("ESP32 CRITICAL ({}): {}", current_port_str, message), // Mapped to error
                                                }
                                            }
                                            Err(_) => { // Not JSON or wrong format
                                                if line.starts_with('{') && line.ends_with('}') {
                                                    warn!("Could not decode JSON from serial ({}): '{}'", current_port_str, line);
                                                } else {
                                                    info!("ESP32 Serial (plaintext on {}): {}", current_port_str, line);
                                                }
                                            }
                                        }
                                    }
                                    line_buf.clear();
                                }
                                Err(e) => {
                                    error!("Serial read error on {}: {}. Attempting to reconnect...", current_port_str, e);
                                    break; // Break inner loop to attempt reconnect
                                }
                            }
                        }
                    }
                } // End inner read loop
                app_state.serial_connection_active.store(false, Ordering::SeqCst);
            }
            Err(e) => {
                error!("Serial listener: Could not open serial port {}: {}", current_port_str, e);
                app_state.serial_connection_active.store(false, Ordering::SeqCst);
            }
        }
        
        // If we are here, connection failed or was lost. Wait before retrying or exiting.
        tokio::select! {
            _ = &mut stop_rx => {
                info!("Serial listener for {} stopping during retry wait.", current_port_str);
                 // Clear current_listener_port only if this task was for the active target port
                if app_state.current_listener_port.lock().unwrap().as_deref() == Some(current_port_str) {
                    *app_state.current_listener_port.lock().unwrap() = None;
                }
                return;
            }
            _ = tokio::time::sleep(Duration::from_secs(5)) => {
                // Check if target port changed while sleeping, if so, new task will be spawned by `start_serial_listener_task`
                // This task should then exit if its `port_name` no longer matches `target_serial_port`
                let current_target = app_state.target_serial_port.lock().unwrap().clone();
                if port_name != current_target {
                    info!("Serial listener for {} stopping as target port changed to {:?}.", current_port_str, current_target);
                    // Clear current_listener_port only if this task was for the active target port
                    if app_state.current_listener_port.lock().unwrap().as_deref() == Some(current_port_str) {
                        *app_state.current_listener_port.lock().unwrap() = None;
                    }
                    return; // Exit task
                }
                // Else, port_name is still the target, continue loop to retry
            }
        }
    } // End outer connection loop

    // Task is finishing
    app_state.serial_connection_active.store(false, Ordering::SeqCst);
    // Final check on current_listener_port
    if let Some(pn_str_ref) = port_name.as_ref() { // Changed to as_ref() to avoid move
       if app_state.current_listener_port.lock().unwrap().as_deref() == Some(pn_str_ref) {
            *app_state.current_listener_port.lock().unwrap() = None;
       }
    } else if app_state.current_listener_port.lock().unwrap().is_none() && port_name.is_none() {
        // If port_name was None and current_listener_port is already None, it's consistent.
    }

    info!("Serial listener task for port {:?} has finished.", port_name);
}

fn start_serial_listener_task(app_state: SharedAppState) {
    info!("start_serial_listener_task called.");
    // Stop existing listener task if any
    if let Some(stop_tx) = app_state.serial_stop_tx.lock().unwrap().take() {
        if stop_tx.send(()).is_err() {
            warn!("Failed to send stop signal to existing serial listener task. It might have already finished.");
        } else {
            info!("Stop signal sent to existing serial listener task.");
        }
    }

    let (new_stop_tx, new_stop_rx) = oneshot::channel::<()>();
    *app_state.serial_stop_tx.lock().unwrap() = Some(new_stop_tx);
    
    app_state.serial_connection_active.store(false, Ordering::SeqCst);
    // current_listener_port will be set by the new task itself.

    let port_to_use = app_state.target_serial_port.lock().unwrap().clone();
    info!("Preparing to start new serial listener for target port: {:?}.", port_to_use);
    
    let state_clone = Arc::clone(&app_state);
    tokio::spawn(async move {
        serial_listener_task(state_clone, port_to_use, new_stop_rx).await;
    });
    info!("New serial listener task (re)started.");
}

// --- Axum Handlers ---
async fn root_handler() -> Html<&'static str> {
    Html(INDEX_HTML)
}

#[derive(Serialize)]
struct ComPortsResponse {
    ports: Vec<String>,
}

async fn get_com_ports_handler() -> AxumJson<ComPortsResponse> {
    match tokio_serial::available_ports() {
        Ok(ports_info) => {
            let port_names = ports_info.into_iter().map(|p| p.port_name).collect();
            info!("Available COM ports: {:?}", port_names);
            AxumJson(ComPortsResponse { ports: port_names })
        }
        Err(e) => {
            error!("Failed to list COM ports: {}", e);
            AxumJson(ComPortsResponse { ports: vec![] })
        }
    }
}

#[derive(Deserialize, Debug)]
struct SetComPortRequest {
    port: Option<String>,
}

#[derive(Serialize)]
struct SetComPortResponse {
    status: String,
    message: String,
}

async fn set_com_port_handler(
    State(app_state): State<SharedAppState>,
    AxumJson(payload): AxumJson<SetComPortRequest>,
) -> AxumJson<SetComPortResponse> {
    let mut new_port_target = payload.port;
    if new_port_target.as_deref() == Some("null") || new_port_target.as_deref() == Some("None") {
        new_port_target = None;
    }

    info!("Request to set COM port to: {:?}", new_port_target);
    
    let mut target_port_guard = app_state.target_serial_port.lock().unwrap();
    if *target_port_guard == new_port_target {
        let msg = format!("Port already targeted to {:?}.", new_port_target);
        info!("{}", msg);
        return AxumJson(SetComPortResponse { status: "no_change".to_string(), message: msg });
    }

    *target_port_guard = new_port_target.clone();
    drop(target_port_guard); // Release lock before calling start_serial_listener_task

    // Reset status flags; serial_listener_task will update them.
    app_state.serial_connection_active.store(false, Ordering::SeqCst);
    *app_state.last_esp32_heartbeat_time.lock().unwrap() = None;

    start_serial_listener_task(Arc::clone(&app_state));

    AxumJson(SetComPortResponse {
        status: "success".to_string(),
        message: format!("Target port set to {:?}. Serial listener restarting.", new_port_target),
    })
}

fn get_esp32_connection_status_obj(app_state: &SharedAppState) -> Esp32ConnectionStatus {
    let current_time = SystemTime::now();
    let last_heartbeat = *app_state.last_esp32_heartbeat_time.lock().unwrap();
    let serial_active = app_state.serial_connection_active.load(Ordering::SeqCst);
    let target_port_opt = app_state.target_serial_port.lock().unwrap().clone();
    let listener_active_port_opt = app_state.current_listener_port.lock().unwrap().clone();

    let esp32_is_online_heartbeat = serial_active
        && last_heartbeat.map_or(false, |lh_time| {
            current_time.duration_since(lh_time).map_or(false, |dur| dur.as_secs() < ESP32_HEARTBEAT_TIMEOUT_SECONDS)
        });
    
    let effective_online_status = serial_active && esp32_is_online_heartbeat && target_port_opt.is_some();

    let status_text = match target_port_opt.as_ref() {
        None => "Select COM Port".to_string(),
        Some(target_port) => {
            if !serial_active {
                // Simplified logic compared to Python, can be expanded if exact Python text is needed
                if listener_active_port_opt.as_deref() == Some(target_port.as_str()) {
                     format!("Connecting to {}...", target_port)
                } else if listener_active_port_opt.is_some() {
                     format!("Switching from {} to {}...", listener_active_port_opt.as_ref().unwrap(), target_port)
                }
                else {
                    format!("Attempting {}...", target_port)
                }
            } else { // serial_active is true
                if !esp32_is_online_heartbeat {
                    if last_heartbeat.is_none() {
                        format!("Connected to {}. Awaiting data...", target_port)
                    } else {
                        // Format last seen time - chrono could be used here for H:M:S
                        let last_seen_str = last_heartbeat
                            .map(|t| {
                                let dt: chrono::DateTime<chrono::Local> = t.into();
                                dt.format("%H:%M:%S").to_string()
                            })
                            .unwrap_or_else(|| "never".to_string());
                        format!("ESP32 unresponsive on {} (Last seen: {})", target_port, last_seen_str)
                    }
                } else {
                    format!("ESP32 Online ({})", target_port)
                }
            }
        }
    };

    Esp32ConnectionStatus {
        online: effective_online_status,
        last_seen_timestamp: last_heartbeat.and_then(|t| t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs())),
        status_text,
        current_port: target_port_opt,
        active_port: listener_active_port_opt,
    }
}


async fn sse_handler(
    State(app_state): State<SharedAppState>,
) -> Sse<impl Stream<Item = Result<SseEvent, Infallible>>> {
    info!("Client connected to SSE stream.");
    let mut metrics_rx = app_state.metrics_tx.subscribe();
    
    // Stream for periodic status updates
    let mut status_interval = interval(Duration::from_secs(1));

    // Send initial status immediately
    let initial_status = get_esp32_connection_status_obj(&app_state);
    let initial_event = ServerEvent { shutter_metrics: None, esp32_connection: initial_status };
    
    let stream = async_stream::stream! { // This requires the async-stream crate
        // Send initial event
        match serde_json::to_string(&initial_event) {
            Ok(json_str) => yield Ok(SseEvent::default().data(json_str)),
            Err(e) => error!("Failed to serialize initial SSE event: {}", e),
        }

        loop {
            tokio::select! {
                // New metrics data from serial port
                Ok(metrics) = metrics_rx.recv() => {
                    let status = get_esp32_connection_status_obj(&app_state);
                    let event_data = ServerEvent {
                        shutter_metrics: Some(metrics),
                        esp32_connection: status,
                    };
                    match serde_json::to_string(&event_data) {
                        Ok(json_str) => yield Ok(SseEvent::default().data(json_str)),
                        Err(e) => error!("Failed to serialize shutter_metrics SSE event: {}", e),
                    }
                }
                // Periodic status update
                _ = status_interval.tick() => {
                     // Check if there's a new metric that arrived just before the tick
                    // This could happen if recv() was pending. A small race but usually okay.
                    // For perfect sync, one might buffer the last metric.
                    let maybe_metric = match metrics_rx.try_recv() {
                        Ok(metric) => Some(metric),
                        Err(broadcast::error::TryRecvError::Empty) => None,
                        Err(broadcast::error::TryRecvError::Lagged(n)) => {
                            warn!("SSE client lagged {} messages for metrics.", n);
                            None
                        }
                        Err(broadcast::error::TryRecvError::Closed) => {
                             warn!("Metrics broadcast channel closed for an SSE client.");
                             break; // End this client's stream
                        }
                    };

                    let status = get_esp32_connection_status_obj(&app_state);
                    let event_data = ServerEvent {
                        shutter_metrics: maybe_metric, // Send if available
                        esp32_connection: status,
                    };
                     match serde_json::to_string(&event_data) {
                        Ok(json_str) => yield Ok(SseEvent::default().data(json_str)),
                        Err(e) => error!("Failed to serialize status SSE event: {}", e),
                    }
                }
                else => { // Branch that handles channel closure or other select! issues
                    info!("SSE stream for a client ended (select! completed).");
                    break;
                }
            }
        }
        info!("Client disconnected from SSE stream.");
    };
    
    Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default())
}


// --- Main Function ---
#[tokio::main]
async fn main() {
    env_logger::Builder::from_default_env()
        .format_timestamp_micros()
        .filter_level(LevelFilter::Info) // Default to Info, can be overridden by RUST_LOG
        .init();

    info!("--- Shutter Diagnostics Interface (Rust) ---");

    let app_state = AppState::new();

    // Start the initial serial listener task (it will idle if no port is set)
    start_serial_listener_task(Arc::clone(&app_state));

    let app = Router::new()
        .route("/", get(root_handler))
        .route("/get_com_ports", get(get_com_ports_handler))
        .route("/set_com_port", post(set_com_port_handler))
        .route("/stream", get(sse_handler))
        .with_state(app_state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 5000));
    info!("Starting server on http://{}", addr);
    info!("ESP32 Heartbeat Timeout: {}s", ESP32_HEARTBEAT_TIMEOUT_SECONDS);
    
    axum::serve(tokio::net::TcpListener::bind(addr).await.unwrap(), app)
        .await
        .unwrap();
}