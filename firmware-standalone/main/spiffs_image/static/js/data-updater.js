// data-updater.js - Largely original logic, minor refinements

// Helper to get a value from the config panel
function getConfigValue(id, defaultValue) {
    const element = document.getElementById(id); // Use document.getElementById directly
    if (element) {
        const value = parseFloat(element.value);
        return isNaN(value) ? defaultValue : value;
    }
    return defaultValue;
}

function updateShutterDisplay(rawData) {
    if (!rawData || typeof rawData.mode === 'undefined') {
        console.error("updateShutterDisplay: Invalid or missing rawData from ESP32.");
        // Optionally clear fields or show an error. setText handles "---" for nulls.
        return;
    }

    // Clear previous client-side calculation errors
    if (DOM.errorDisplay && DOM.errorDisplay.innerHTML.includes("CLIENT CALC ERROR")) {
        DOM.errorDisplay.innerHTML = '';
    }
    
    const errors = []; // For client-side calculation errors

    // --- 0. Get Configuration for Calculations ---
    const totalSensorDistanceMm = getConfigValue('totalSensorDistanceConfig', 30.0);
    const timeScalingFactor = getCurrentTimeScalingFactor(); // From config-panel.js

    // --- 1. Raw times (already in µs from ESP32) ---
    const s1_o_us = rawData.s1_open_us;
    const s1_c_us = rawData.s1_close_us;
    const s2_o_us = rawData.s2_open_us;
    const s2_c_us = rawData.s2_close_us;
    const s3_o_us = rawData.s3_open_us;
    const s3_c_us = rawData.s3_close_us;

    const selectedUnit = DOM.timestampUnitSelector.value;
    setText('raw_s1', formatRawTimestamp(s1_o_us, selectedUnit) + ' / ' + formatRawTimestamp(s1_c_us, selectedUnit));
    setText('raw_s2', formatRawTimestamp(s2_o_us, selectedUnit) + ' / ' + formatRawTimestamp(s2_c_us, selectedUnit));
    setText('raw_s3', formatRawTimestamp(s3_o_us, selectedUnit) + ' / ' + formatRawTimestamp(s3_c_us, selectedUnit));

    // --- 2. Exposure Times (calculate in µs, then convert to ms for display) ---
    const getExposureUs = (open_us, close_us) => (open_us > 0 && close_us > open_us) ? (close_us - open_us) : 0;
    
    let exp_us_s1 = 0, exp_us_s2 = 0, exp_us_s3 = 0;

    if (rawData.mode === "ALL" || rawData.mode === "OUTER") {
        exp_us_s1 = getExposureUs(s1_o_us, s1_c_us);
        if (s1_o_us > 0 && s1_c_us > 0 && s1_c_us <= s1_o_us && s1_o_us !== s1_c_us) errors.push("S1: Close time before or at open time.");
    }
    if (rawData.mode === "ALL" || rawData.mode === "INNER") {
        exp_us_s2 = getExposureUs(s2_o_us, s2_c_us);
        if (s2_o_us > 0 && s2_c_us > 0 && s2_c_us <= s2_o_us && s2_o_us !== s2_c_us) errors.push("S2: Close time before or at open time.");
    }
    if (rawData.mode === "ALL" || rawData.mode === "OUTER") {
        exp_us_s3 = getExposureUs(s3_o_us, s3_c_us);
        if (s3_o_us > 0 && s3_c_us > 0 && s3_c_us <= s3_o_us && s3_o_us !== s3_c_us) errors.push("S3: Close time before or at open time.");
    }
    
    const exp_ms_s1 = exp_us_s1 > 0 ? exp_us_s1 / 1000.0 : null;
    const exp_ms_s2 = exp_us_s2 > 0 ? exp_us_s2 / 1000.0 : null;
    const exp_ms_s3 = exp_us_s3 > 0 ? exp_us_s3 / 1000.0 : null;

    setText('exp_ms_s1', exp_ms_s1, 3);
    setText('exp_ms_s2', exp_ms_s2, 3);
    setText('exp_ms_s3', exp_ms_s3, 3);
    calculateAndDisplayComparison(exp_ms_s1, exp_ms_s2, 'exp_compare_s1s2');
    calculateAndDisplayComparison(exp_ms_s2, exp_ms_s3, 'exp_compare_s2s3');

    // --- 3. Shutter Speeds (Hz equivalent = 1 / exposure_seconds) ---
    const getHz = (exp_us) => (exp_us > 0) ? (1.0 / (exp_us / 1000000.0)) : null;
    const hz_s1_val = getHz(exp_us_s1);
    const hz_s2_val = getHz(exp_us_s2);
    const hz_s3_val = getHz(exp_us_s3);

    setText('hz_s1', hz_s1_val, (hz_s1_val !== null && isFinite(hz_s1_val)) ? 2 : undefined);
    setText('hz_s2', hz_s2_val, (hz_s2_val !== null && isFinite(hz_s2_val)) ? 2 : undefined);
    setText('hz_s3', hz_s3_val, (hz_s3_val !== null && isFinite(hz_s3_val)) ? 2 : undefined);

    // --- 4. Average Exposure and Hz ---
    let validExposuresMs = [];
    if (exp_ms_s1 !== null && (rawData.mode === "ALL" || rawData.mode === "OUTER")) validExposuresMs.push(exp_ms_s1);
    if (exp_ms_s2 !== null && (rawData.mode === "ALL" || rawData.mode === "INNER")) validExposuresMs.push(exp_ms_s2);
    if (exp_ms_s3 !== null && (rawData.mode === "ALL" || rawData.mode === "OUTER")) validExposuresMs.push(exp_ms_s3);
    
    let avgExpMs = null;
    if (validExposuresMs.length > 0) {
        avgExpMs = validExposuresMs.reduce((a, b) => a + b, 0) / validExposuresMs.length;
    }
    setText('exp_ms_avg', avgExpMs, 3);

    let validHz = [];
    function parseHz(val) { return (val !== null && isFinite(val)) ? val : null; } // isFinite handles Infinity
    let h1 = parseHz(hz_s1_val); let h2 = parseHz(hz_s2_val); let h3 = parseHz(hz_s3_val);
    if (h1 !== null && (rawData.mode === "ALL" || rawData.mode === "OUTER")) validHz.push(h1);
    if (h2 !== null && (rawData.mode === "ALL" || rawData.mode === "INNER")) validHz.push(h2);
    if (h3 !== null && (rawData.mode === "ALL" || rawData.mode === "OUTER")) validHz.push(h3);
    
    let avgHz = null;
    if (validHz.length > 0) {
        avgHz = validHz.reduce((a, b) => a + b, 0) / validHz.length;
    }
    setText('hz_avg', avgHz, 2);
    
    // --- 5. Curtain Travel Times (calculate in µs, display in ms after scaling) ---
    let c1_s1s2_us = 0, c1_s2s3_us = 0, c1_s1s3_us = 0;
    let c2_s1s2_us = 0, c2_s2s3_us = 0, c2_s1s3_us = 0;

    // S1-S3 (Overall travel for OUTER or ALL)
    if (rawData.mode === "ALL" || rawData.mode === "OUTER") {
        if (s1_o_us > 0 && s3_o_us > s1_o_us) c1_s1s3_us = s3_o_us - s1_o_us;
        else if (s1_o_us > 0 && s3_o_us > 0 && s1_o_us !== s3_o_us) errors.push("C1: S3 open not after S1 open.");
        
        if (s1_c_us > 0 && s3_c_us > s1_c_us) c2_s1s3_us = s3_c_us - s1_c_us;
        else if (s1_c_us > 0 && s3_c_us > 0 && s1_c_us !== s3_c_us) errors.push("C2: S3 close not after S1 close.");
    }
    // S1-S2 and S2-S3 (Segments, only for ALL mode)
    if (rawData.mode === "ALL") {
        if (s1_o_us > 0 && s2_o_us > s1_o_us) c1_s1s2_us = s2_o_us - s1_o_us;
        else if (s1_o_us > 0 && s2_o_us > 0 && s1_o_us !== s2_o_us) errors.push("C1: S2 open not after S1 open.");
        
        if (s2_o_us > 0 && s3_o_us > s2_o_us) c1_s2s3_us = s3_o_us - s2_o_us;
        else if (s2_o_us > 0 && s3_o_us > 0 && s2_o_us !== s3_o_us) errors.push("C1: S3 open not after S2 open.");
        
        if (s1_c_us > 0 && s2_c_us > s1_c_us) c2_s1s2_us = s2_c_us - s1_c_us;
        else if (s1_c_us > 0 && s2_c_us > 0 && s1_c_us !== s2_c_us) errors.push("C2: S2 close not after S1 close.");
        
        if (s2_c_us > 0 && s3_c_us > s2_c_us) c2_s2s3_us = s3_c_us - s2_c_us;
        else if (s2_c_us > 0 && s3_c_us > 0 && s2_c_us !== s3_c_us) errors.push("C2: S3 close not after S2 close.");
    }
    
    const toScaledMs = (val_us) => (val_us > 0) ? (val_us * timeScalingFactor / 1000.0) : null;

    const c1_s1s2_scaled_ms = toScaledMs(c1_s1s2_us);
    const c1_s2s3_scaled_ms = toScaledMs(c1_s2s3_us);
    const c1_total_scaled_ms = toScaledMs(c1_s1s3_us);
    setText('ct_c1_s1s2_time', c1_s1s2_scaled_ms, 3);
    setText('ct_c1_s2s3_time', c1_s2s3_scaled_ms, 3);
    setText('ct_c1_total_time', c1_total_scaled_ms, 3);
    if (rawData.mode === "ALL") calculateAndDisplayComparison(c1_s1s2_scaled_ms, c1_s2s3_scaled_ms, 'ct_c1_intra_pct_var');
    else setText('ct_c1_intra_pct_var', null);


    const c2_s1s2_scaled_ms = toScaledMs(c2_s1s2_us);
    const c2_s2s3_scaled_ms = toScaledMs(c2_s2s3_us);
    const c2_total_scaled_ms = toScaledMs(c2_s1s3_us);
    setText('ct_c2_s1s2_time', c2_s1s2_scaled_ms, 3);
    setText('ct_c2_s2s3_time', c2_s2s3_scaled_ms, 3);
    setText('ct_c2_total_time', c2_total_scaled_ms, 3);
    if (rawData.mode === "ALL") calculateAndDisplayComparison(c2_s1s2_scaled_ms, c2_s2s3_scaled_ms, 'ct_c2_intra_pct_var');
    else setText('ct_c2_intra_pct_var', null);

    // C1 vs C2 comparisons
    if (rawData.mode === "ALL") {
        calculateAndDisplayComparison(c1_s1s2_scaled_ms, c2_s1s2_scaled_ms, 'ct_c1c2_s1s2_compare_pct');
        calculateAndDisplayComparison(c1_s2s3_scaled_ms, c2_s2s3_scaled_ms, 'ct_c1c2_s2s3_compare_pct');
    } else {
        setText('ct_c1c2_s1s2_compare_pct', null);
        setText('ct_c1c2_s2s3_compare_pct', null);
    }
    if (rawData.mode === "ALL" || rawData.mode === "OUTER") {
        calculateAndDisplayComparison(c1_total_scaled_ms, c2_total_scaled_ms, 'ct_c1c2_total_compare_pct');
    } else {
         setText('ct_c1c2_total_compare_pct', null);
    }


    // --- 6. Shutter Fully Open Duration (Avg Effective Exposure) & Slit Width ---
    setText('open_time_duration_ms', avgExpMs, 3); // Using avgExpMs as "effective exposure"

    let avg_slit_width_mm = null;
    if (avgExpMs !== null && avgExpMs > 0 && totalSensorDistanceMm > 0 && timeScalingFactor > 0) {
        const avg_exp_s = avgExpMs / 1000.0;
        // Use C1 total travel time for slit width calculation if available, else C2.
        // c1_s1s3_us is unscaled. timeScalingFactor will be applied.
        const avg_c_total_s = (c1_s1s3_us > 0) ? (c1_s1s3_us * timeScalingFactor / 1000000.0) :
                              ((c2_s1s3_us > 0) ? (c2_s1s3_us * timeScalingFactor / 1000000.0) : 0);
        
        if (avg_c_total_s > 0) {
            avg_slit_width_mm = totalSensorDistanceMm * avg_exp_s / avg_c_total_s;
        } else if (rawData.mode === "ALL" || rawData.mode === "OUTER") { // Only error if we expected travel time
            errors.push("Cannot calculate slit width: Avg curtain travel time is zero or S1-S3 not active.");
        }
    }
    setText('slit_width_mm', avg_slit_width_mm, 2);

    // --- 7. Exposure Variation % ---
    let exp_var_pct = null;
    if (validExposuresMs.length > 1 && avgExpMs !== null && avgExpMs > 0) {
        let sumOfSquares = 0;
        validExposuresMs.forEach(exp => { sumOfSquares += Math.pow(exp - avgExpMs, 2); });
        const stdDev = Math.sqrt(sumOfSquares / validExposuresMs.length);
        exp_var_pct = (stdDev / avgExpMs) * 100.0;
    }
    setText('exp_var_pct', exp_var_pct, 2, exp_var_pct === null ? '' : '%');

    // --- Display errors from client-side calculations ---
    if (DOM.errorDisplay && errors.length > 0) {
        var errorHtml = DOM.errorDisplay.innerHTML; 
        if (!errorHtml.includes("Calculation Issues")) errorHtml = ""; 
        errorHtml += '<p class="error-message">CLIENT CALC ERROR:</p><ul>';
        errors.forEach(function(err) { errorHtml += '<li class="error-message">' + err + '</li>'; });
        errorHtml += '</ul>';
        DOM.errorDisplay.innerHTML = errorHtml;
    }
    
    if (typeof addResultToLog === 'function') addResultToLog();
}


function updateEsp32Status(isConnected, message, lastSeenTimestamp) {
    if (DOM.esp32ConnectionStatus) {
        DOM.esp32ConnectionStatus.textContent = message || (isConnected ? "Connected" : "Disconnected / Error");
        DOM.esp32ConnectionStatus.className = 'data-value '; // Reset classes
        if (isConnected) {
            DOM.esp32ConnectionStatus.classList.add('esp32-connected');
        } else {
             DOM.esp32ConnectionStatus.classList.add('esp32-disconnected');
        }
    }
    if (DOM.lastUpdate) {
        if (lastSeenTimestamp) {
            const updateTime = new Date(lastSeenTimestamp);
            DOM.lastUpdate.textContent = updateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        } else {
            DOM.lastUpdate.textContent = 'N/A';
        }
    }
}

function updateEspModeDisplay(modeStringFromServer) {
    if (modeStringFromServer && DOM.sensorModeSelector) {
        let modeValueToSelect = "0"; // Default to "All Sensors"

        switch (modeStringFromServer.toUpperCase()) {
            case "ALL": modeValueToSelect = "0"; break;
            case "OUTER": modeValueToSelect = "1"; break;
            case "INNER": modeValueToSelect = "2"; break;
            case "UNKNOWN": // Fallthrough if UNKNOWN should also default to "All"
            default: modeValueToSelect = "0"; break;
        }
        // Only update if different, to prevent re-triggering change events if not careful
        if (DOM.sensorModeSelector.value !== modeValueToSelect) {
            DOM.sensorModeSelector.value = modeValueToSelect;
        }
    }
}