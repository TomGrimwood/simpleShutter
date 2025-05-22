function updateShutterDisplay(metrics) {
    if (!metrics) return;

    if (metrics.errors && metrics.errors.length > 0) {
        var errorHtml = '<p class="error-message">Calculation Issues:</p><ul>';
        metrics.errors.forEach(function(err) { errorHtml += '<li class="error-message">' + err + '</li>'; });
        errorHtml += '</ul>';
        DOM.errorDisplay.innerHTML = errorHtml;
    } else if (DOM.errorDisplay.innerHTML.includes("Calculation Issues")) {
        DOM.errorDisplay.innerHTML = '';
    }

    // The line below is removed as 'current-mode-display' element no longer exists.
    // The sensor mode selector is updated by updateEspModeDisplay.
    // setText('current-mode-display', metrics.measurement_mode ? metrics.measurement_mode : '---');

    var exp_ms_s1 = metrics.exposure_times_ms ? metrics.exposure_times_ms.s1 : null;
    var exp_ms_s2 = metrics.exposure_times_ms ? metrics.exposure_times_ms.s2 : null;
    var exp_ms_s3 = metrics.exposure_times_ms ? metrics.exposure_times_ms.s3 : null;
    setText('exp_ms_s1', exp_ms_s1, 3);
    setText('exp_ms_s2', exp_ms_s2, 3);
    setText('exp_ms_s3', exp_ms_s3, 3);
    calculateAndDisplayComparison(exp_ms_s1, exp_ms_s2, 'exp_compare_s1s2');
    calculateAndDisplayComparison(exp_ms_s2, exp_ms_s3, 'exp_compare_s2s3');

    var validExposuresMs = [];
    if (exp_ms_s1 !== null && !isNaN(parseFloat(exp_ms_s1))) validExposuresMs.push(parseFloat(exp_ms_s1));
    if (exp_ms_s2 !== null && !isNaN(parseFloat(exp_ms_s2))) validExposuresMs.push(parseFloat(exp_ms_s2));
    if (exp_ms_s3 !== null && !isNaN(parseFloat(exp_ms_s3))) validExposuresMs.push(parseFloat(exp_ms_s3));
    if (validExposuresMs.length > 0) {
        var avgExpMs = validExposuresMs.reduce((a, b) => a + b, 0) / validExposuresMs.length;
        setText('exp_ms_avg', avgExpMs, 3, '');
    } else {
        setText('exp_ms_avg', null);
    }

    var hz_s1_val = metrics.shutter_speeds_hz_equivalent ? metrics.shutter_speeds_hz_equivalent.s1 : null;
    var hz_s2_val = metrics.shutter_speeds_hz_equivalent ? metrics.shutter_speeds_hz_equivalent.s2 : null;
    var hz_s3_val = metrics.shutter_speeds_hz_equivalent ? metrics.shutter_speeds_hz_equivalent.s3 : null;
    setText('hz_s1', hz_s1_val, 2);
    setText('hz_s2', hz_s2_val, 2);
    setText('hz_s3', hz_s3_val, 2);

    var validHz = [];
    function parseHz(val) { return (val !== null && val !== "inf" && !isNaN(parseFloat(val))) ? parseFloat(val) : null; }
    let h1 = parseHz(hz_s1_val); let h2 = parseHz(hz_s2_val); let h3 = parseHz(hz_s3_val);
    if (h1 !== null) validHz.push(h1); if (h2 !== null) validHz.push(h2); if (h3 !== null) validHz.push(h3);
    if (validHz.length > 0) {
        var avgHz = validHz.reduce((a, b) => a + b, 0) / validHz.length;
        setText('hz_avg', avgHz, 2, '');
    } else {
        setText('hz_avg', null);
    }

    setText('open_time_duration_ms', metrics.open_time_duration_ms, 3);
    setText('slit_width_mm', metrics.average_slit_width_mm, (typeof metrics.average_slit_width_mm === 'number' ? 2 : undefined));
    setText('exp_var_pct', metrics.exposure_variation_percent_from_avg, 2, metrics.exposure_variation_percent_from_avg === null ? '' : '%');
    
    const currentScalingFactor = getCurrentTimeScalingFactor(); // From config-panel.js

    var c1_s1s2_raw = (metrics.curtain1_travel_times_ms && typeof metrics.curtain1_travel_times_ms.s1_to_s2 !== 'undefined') ? metrics.curtain1_travel_times_ms.s1_to_s2 : null;
    var c1_s2s3_raw = (metrics.curtain1_travel_times_ms && typeof metrics.curtain1_travel_times_ms.s2_to_s3 !== 'undefined') ? metrics.curtain1_travel_times_ms.s2_to_s3 : null;
    var c1_s1s3_raw = (metrics.curtain1_travel_times_ms && typeof metrics.curtain1_travel_times_ms.s1_to_s3_total !== 'undefined') ? metrics.curtain1_travel_times_ms.s1_to_s3_total : null;
    var c1_s1s2_scaled = (c1_s1s2_raw !== null) ? c1_s1s2_raw * currentScalingFactor : null;
    var c1_s2s3_scaled = (c1_s2s3_raw !== null) ? c1_s2s3_raw * currentScalingFactor : null;
    var c1_total_scaled = (c1_s1s3_raw !== null) ? c1_s1s3_raw * currentScalingFactor : null;
    setText('ct_c1_s1s2_time', c1_s1s2_scaled, 3);
    setText('ct_c1_s2s3_time', c1_s2s3_scaled, 3);
    setText('ct_c1_total_time', c1_total_scaled, 3);
    calculateAndDisplayComparison(c1_s1s2_scaled, c1_s2s3_scaled, 'ct_c1_intra_pct_var');

    var c2_s1s2_raw = (metrics.curtain2_travel_times_ms && typeof metrics.curtain2_travel_times_ms.s1_to_s2 !== 'undefined') ? metrics.curtain2_travel_times_ms.s1_to_s2 : null;
    var c2_s2s3_raw = (metrics.curtain2_travel_times_ms && typeof metrics.curtain2_travel_times_ms.s2_to_s3 !== 'undefined') ? metrics.curtain2_travel_times_ms.s2_to_s3 : null;
    var c2_s1s3_raw = (metrics.curtain2_travel_times_ms && typeof metrics.curtain2_travel_times_ms.s1_to_s3_total !== 'undefined') ? metrics.curtain2_travel_times_ms.s1_to_s3_total : null;
    var c2_s1s2_scaled = (c2_s1s2_raw !== null) ? c2_s1s2_raw * currentScalingFactor : null;
    var c2_s2s3_scaled = (c2_s2s3_raw !== null) ? c2_s2s3_raw * currentScalingFactor : null;
    var c2_total_scaled = (c2_s1s3_raw !== null) ? c2_s1s3_raw * currentScalingFactor : null;
    setText('ct_c2_s1s2_time', c2_s1s2_scaled, 3);
    setText('ct_c2_s2s3_time', c2_s2s3_scaled, 3);
    setText('ct_c2_total_time', c2_total_scaled, 3);
    calculateAndDisplayComparison(c2_s1s2_scaled, c2_s2s3_scaled, 'ct_c2_intra_pct_var');

    calculateAndDisplayComparison(c1_s1s2_scaled, c2_s1s2_scaled, 'ct_c1c2_s1s2_compare_pct');
    calculateAndDisplayComparison(c1_s2s3_scaled, c2_s2s3_scaled, 'ct_c1c2_s2s3_compare_pct');
    calculateAndDisplayComparison(c1_total_scaled, c2_total_scaled, 'ct_c1c2_total_compare_pct');

    var selectedUnit = DOM.timestampUnitSelector.value;
    var raw_s1_o_us = (metrics.raw_times_us && typeof metrics.raw_times_us.s1_open !== 'undefined') ? metrics.raw_times_us.s1_open : null;
    var raw_s1_c_us = (metrics.raw_times_us && typeof metrics.raw_times_us.s1_close !== 'undefined') ? metrics.raw_times_us.s1_close : null;
    setText('raw_s1', formatRawTimestamp(raw_s1_o_us, selectedUnit) + ' / ' + formatRawTimestamp(raw_s1_c_us, selectedUnit));
    var raw_s2_o_us = (metrics.raw_times_us && typeof metrics.raw_times_us.s2_open !== 'undefined') ? metrics.raw_times_us.s2_open : null;
    var raw_s2_c_us = (metrics.raw_times_us && typeof metrics.raw_times_us.s2_close !== 'undefined') ? metrics.raw_times_us.s2_close : null;
    setText('raw_s2', formatRawTimestamp(raw_s2_o_us, selectedUnit) + ' / ' + formatRawTimestamp(raw_s2_c_us, selectedUnit));
    var raw_s3_o_us = (metrics.raw_times_us && typeof metrics.raw_times_us.s3_open !== 'undefined') ? metrics.raw_times_us.s3_open : null;
    var raw_s3_c_us = (metrics.raw_times_us && typeof metrics.raw_times_us.s3_close !== 'undefined') ? metrics.raw_times_us.s3_close : null;
    setText('raw_s3', formatRawTimestamp(raw_s3_o_us, selectedUnit) + ' / ' + formatRawTimestamp(raw_s3_c_us, selectedUnit));
    
    addResultToLog(); // From results-log.js
}


function updateEsp32Status(statusData) {
    var el = document.getElementById('esp32-connection-status');
    if (el && statusData) {
        el.textContent = statusData.status_text;
        el.className = 'data-value '; // Reset classes
        if (statusData.online) {
            el.classList.add('esp32-connected');
        } else {
            if (statusData.current_port === null || statusData.status_text.includes("Select COM Port") || statusData.status_text.includes("Connecting") || statusData.status_text.includes("Switching") || statusData.status_text.includes("Initializing") || statusData.status_text.includes("Attempting")) {
                el.classList.add('esp32-unknown');
            } else {
                el.classList.add('esp32-disconnected');
            }
        }
        
        var reportedPort = statusData.current_port === null ? "null" : statusData.current_port;
        if (window.AppState.currentBackendSerialPort !== reportedPort) { 
             window.AppState.currentBackendSerialPort = reportedPort;
             if (document.activeElement !== DOM.comPortSelector && DOM.comPortSelector.value !== window.AppState.currentBackendSerialPort) {
                DOM.comPortSelector.value = window.AppState.currentBackendSerialPort; 
             }
        }
    }
    var lastUpdateEl = document.getElementById('last-update');
    if (statusData && statusData.last_seen_timestamp) {
        var updateTime = new Date(statusData.last_seen_timestamp * 1000);
        lastUpdateEl.textContent = updateTime.getHours().toString().padStart(2, '0') + ':' + updateTime.getMinutes().toString().padStart(2, '0') + ':' + updateTime.getSeconds().toString().padStart(2, '0');
    } else {
        if (lastUpdateEl.textContent === 'N/A' || !lastUpdateEl.textContent.includes(':')) {
             lastUpdateEl.textContent = 'N/A';
        }
    }
}

function updateEspModeDisplay(modeStatus) {
    // This function now updates the sensorModeSelector dropdown
    if (modeStatus && modeStatus.current_mode && DOM.sensorModeSelector) {
        let modeValueToSelect = "0"; // Default to "All Sensors" (value "0")

        switch (modeStatus.current_mode.toUpperCase()) {
            case "ALL":
                modeValueToSelect = "0";
                break;
            case "OUTER":
                modeValueToSelect = "1";
                break;
            case "INNER":
                modeValueToSelect = "2";
                break;
            case "UNKNOWN":
            default:
                // If mode is UNKNOWN or not recognized, default to "All Sensors".
                // The main ESP32 connection status will indicate if there's a broader issue.
                modeValueToSelect = "0"; 
                break;
        }
        // Set the selector's value. Programmatic changes to .value do not trigger 'change' events,
        // which prevents an unwanted loop of setEspMode commands.
        if (DOM.sensorModeSelector.value !== modeValueToSelect) {
            DOM.sensorModeSelector.value = modeValueToSelect;
        }
    }
}