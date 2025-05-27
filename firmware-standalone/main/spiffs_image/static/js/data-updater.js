// data-updater.js

// Helper to get a value from the config panel, assuming it's available globally or via AppState
function getConfigValue(id, defaultValue) {
    const element = document.getElementById(id);
    if (element) {
        const value = parseFloat(element.value);
        return isNaN(value) ? defaultValue : value;
    }
    return defaultValue;
}

function updateShutterDisplay(rawData) { // rawData comes from ESP32's /api/getdata
    if (!rawData || typeof rawData.mode === 'undefined') {
        console.error("updateShutterDisplay: Invalid or missing rawData from ESP32.");
        // Optionally clear fields or show an error
        // For now, let existing N/A logic in setText handle it if fields are null.
        return;
    }

    // Clear previous calculation errors if any were displayed by JS
    if (DOM.errorDisplay.innerHTML.includes("CLIENT CALC ERROR")) {
        DOM.errorDisplay.innerHTML = '';
    }
    
    const errors = []; // For client-side calculation errors

    // --- 0. Get Configuration for Calculations ---
    const totalSensorDistanceMm = getConfigValue('totalSensorDistanceConfig', 30.0); // Default S1-S3 distance
    // const calibrationTargetDistanceMm = getConfigValue('calibrationTargetDistanceConfig', 32.0); // Used for scaling factor
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
        if (s1_o_us > 0 && s1_c_us > 0 && s1_c_us <= s1_o_us) errors.push("S1: Close time before or at open time.");
    }
    if (rawData.mode === "ALL" || rawData.mode === "INNER") {
        exp_us_s2 = getExposureUs(s2_o_us, s2_c_us);
        if (s2_o_us > 0 && s2_c_us > 0 && s2_c_us <= s2_o_us) errors.push("S2: Close time before or at open time.");
    }
    if (rawData.mode === "ALL" || rawData.mode === "OUTER") {
        exp_us_s3 = getExposureUs(s3_o_us, s3_c_us);
        if (s3_o_us > 0 && s3_c_us > 0 && s3_c_us <= s3_o_us) errors.push("S3: Close time before or at open time.");
    }
    
    const exp_ms_s1 = exp_us_s1 > 0 ? exp_us_s1 / 1000.0 : null;
    const exp_ms_s2 = exp_us_s2 > 0 ? exp_us_s2 / 1000.0 : null;
    const exp_ms_s3 = exp_us_s3 > 0 ? exp_us_s3 / 1000.0 : null;

    setText('exp_ms_s1', exp_ms_s1, 3);
    setText('exp_ms_s2', exp_ms_s2, 3);
    setText('exp_ms_s3', exp_ms_s3, 3);
    calculateAndDisplayComparison(exp_ms_s1, exp_ms_s2, 'exp_compare_s1s2'); // from sc.js
    calculateAndDisplayComparison(exp_ms_s2, exp_ms_s3, 'exp_compare_s2s3'); // from sc.js

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
    if (exp_ms_s1 !== null) validExposuresMs.push(exp_ms_s1);
    if (exp_ms_s2 !== null && (rawData.mode === "ALL" || rawData.mode === "INNER")) validExposuresMs.push(exp_ms_s2); // Only include S2 if active
    if (exp_ms_s3 !== null && (rawData.mode === "ALL" || rawData.mode === "OUTER")) validExposuresMs.push(exp_ms_s3); // Only include S3 if active
    
    if (validExposuresMs.length > 0) {
        var avgExpMs = validExposuresMs.reduce((a, b) => a + b, 0) / validExposuresMs.length;
        setText('exp_ms_avg', avgExpMs, 3, '');
    } else {
        setText('exp_ms_avg', null);
    }

    let validHz = [];
    function parseHz(val) { return (val !== null && isFinite(val)) ? val : null; }
    let h1 = parseHz(hz_s1_val); let h2 = parseHz(hz_s2_val); let h3 = parseHz(hz_s3_val);
    if (h1 !== null && (rawData.mode === "ALL" || rawData.mode === "OUTER")) validHz.push(h1);
    if (h2 !== null && (rawData.mode === "ALL" || rawData.mode === "INNER")) validHz.push(h2);
    if (h3 !== null && (rawData.mode === "ALL" || rawData.mode === "OUTER")) validHz.push(h3);
    
    if (validHz.length > 0) {
        var avgHz = validHz.reduce((a, b) => a + b, 0) / validHz.length;
        setText('hz_avg', avgHz, 2, '');
    } else {
        setText('hz_avg', null);
    }
    
    // --- 5. Curtain Travel Times (calculate in µs, display in ms after scaling) ---
    // All calculations use raw µs, then scale, then convert to ms for display.
    let c1_s1s2_us = 0, c1_s2s3_us = 0, c1_s1s3_us = 0;
    let c2_s1s2_us = 0, c2_s2s3_us = 0, c2_s1s3_us = 0;

    if (rawData.mode === "ALL" || rawData.mode === "OUTER") { // S1 and S3 involved
        if (s1_o_us > 0 && s3_o_us > s1_o_us) c1_s1s3_us = s3_o_us - s1_o_us; else if (s1_o_us > 0 && s3_o_us > 0) errors.push("C1: S3 open before S1 open.");
        if (s1_c_us > 0 && s3_c_us > s1_c_us) c2_s1s3_us = s3_c_us - s1_c_us; else if (s1_c_us > 0 && s3_c_us > 0) errors.push("C2: S3 close before S1 close.");
    }
    if (rawData.mode === "ALL") { // S1, S2, S3 involved
        if (s1_o_us > 0 && s2_o_us > s1_o_us) c1_s1s2_us = s2_o_us - s1_o_us; else if (s1_o_us > 0 && s2_o_us > 0) errors.push("C1: S2 open before S1 open.");
        if (s2_o_us > 0 && s3_o_us > s2_o_us) c1_s2s3_us = s3_o_us - s2_o_us; else if (s2_o_us > 0 && s3_o_us > 0) errors.push("C1: S3 open before S2 open.");
        
        if (s1_c_us > 0 && s2_c_us > s1_c_us) c2_s1s2_us = s2_c_us - s1_c_us; else if (s1_c_us > 0 && s2_c_us > 0) errors.push("C2: S2 close before S1 close.");
        if (s2_c_us > 0 && s3_c_us > s2_c_us) c2_s2s3_us = s3_c_us - s2_c_us; else if (s2_c_us > 0 && s3_c_us > 0) errors.push("C2: S3 close before S2 close.");
    }
    
    // Apply scaling factor and convert to ms for display
    const toScaledMs = (val_us) => (val_us > 0) ? (val_us * timeScalingFactor / 1000.0) : null;

    setText('ct_c1_s1s2_time', toScaledMs(c1_s1s2_us), 3);
    setText('ct_c1_s2s3_time', toScaledMs(c1_s2s3_us), 3);
    setText('ct_c1_total_time', toScaledMs(c1_s1s3_us), 3);
    calculateAndDisplayComparison(toScaledMs(c1_s1s2_us), toScaledMs(c1_s2s3_us), 'ct_c1_intra_pct_var');

    setText('ct_c2_s1s2_time', toScaledMs(c2_s1s2_us), 3);
    setText('ct_c2_s2s3_time', toScaledMs(c2_s2s3_us), 3);
    setText('ct_c2_total_time', toScaledMs(c2_s1s3_us), 3);
    calculateAndDisplayComparison(toScaledMs(c2_s1s2_us), toScaledMs(c2_s2s3_us), 'ct_c2_intra_pct_var');

    calculateAndDisplayComparison(toScaledMs(c1_s1s2_us), toScaledMs(c2_s1s2_us), 'ct_c1c2_s1s2_compare_pct');
    calculateAndDisplayComparison(toScaledMs(c1_s2s3_us), toScaledMs(c2_s2s3_us), 'ct_c1c2_s2s3_compare_pct');
    calculateAndDisplayComparison(toScaledMs(c1_s1s3_us), toScaledMs(c2_s1s3_us), 'ct_c1c2_total_compare_pct');

    // --- 6. Shutter Fully Open Duration & Slit Width ---
    // Shutter fully open duration: Time from S1 (top) closes to S3 (bottom) opens.
    // This is a bit ambiguous. A common interpretation for focal plane is time for slit to pass a point.
    // The original UI had "open_time_duration_ms". Let's assume it means average exposure for now, or time for slit to pass.
    // If slit width is constant, average exposure is a good proxy.
    // If we define it as (average S3_open_us - average S1_close_us) this is complex.
    // Let's use average exposure time as "open_time_duration_ms" for now.
    setText('open_time_duration_ms', avgExpMs, 3);

    // Average Slit Width (mm) = Sensor Distance (mm) * Average Exposure Time (s) / Average Curtain Travel Time (s) for S1-S3
    // This requires S1-S3 distance.
    let avg_slit_width_mm = null;
    if (avgExpMs > 0 && totalSensorDistanceMm > 0) {
        const avg_exp_s = avgExpMs / 1000.0;
        const avg_c1_total_s = (c1_s1s3_us > 0) ? (c1_s1s3_us * timeScalingFactor / 1000000.0) : 0;
        // const avg_c2_total_s = (c2_s1s3_us > 0) ? (c2_s1s3_us * timeScalingFactor / 1000000.0) : 0;
        // Choose one curtain or average them for travel time if they are similar. Let's use C1 for now.
        if (avg_c1_total_s > 0) {
            avg_slit_width_mm = totalSensorDistanceMm * avg_exp_s / avg_c1_total_s;
        } else {
            errors.push("Cannot calculate slit width: Avg C1 travel time is zero.");
        }
    }
    setText('slit_width_mm', avg_slit_width_mm, 2);

    // --- 7. Exposure Variation % ---
    let exp_var_pct = null;
    if (validExposuresMs.length > 1 && avgExpMs > 0) {
        let sumOfSquares = 0;
        validExposuresMs.forEach(exp => { sumOfSquares += Math.pow(exp - avgExpMs, 2); });
        const stdDev = Math.sqrt(sumOfSquares / validExposuresMs.length);
        exp_var_pct = (stdDev / avgExpMs) * 100.0; // Coefficient of variation
    }
    setText('exp_var_pct', exp_var_pct, 2, exp_var_pct === null ? '' : '%');

    // --- Display errors from client-side calculations ---
    if (errors.length > 0) {
        var errorHtml = DOM.errorDisplay.innerHTML; // Preserve server errors if any
        if (!errorHtml.includes("Calculation Issues")) errorHtml = ""; // Clear if it's not server calc issues
        errorHtml += '<p class="error-message">CLIENT CALC ERROR:</p><ul>';
        errors.forEach(function(err) { errorHtml += '<li class="error-message">' + err + '</li>'; });
        errorHtml += '</ul>';
        DOM.errorDisplay.innerHTML = errorHtml;
    }
    
    addResultToLog(); // From results-log.js
}


function updateEsp32Status(isConnected, message, lastSeenTimestamp) {
    var el = document.getElementById('esp32-connection-status');
    if (el) {
        el.textContent = message || (isConnected ? "Connected" : "Disconnected / Error");
        el.className = 'data-value '; // Reset classes
        if (isConnected) {
            el.classList.add('esp32-connected');
        } else {
             el.classList.add('esp32-disconnected');
        }
    }
    var lastUpdateEl = document.getElementById('last-update');
    if (lastSeenTimestamp) {
        var updateTime = new Date(lastSeenTimestamp); // Assume it's ms or a parsable string
        lastUpdateEl.textContent = updateTime.getHours().toString().padStart(2, '0') + ':' + updateTime.getMinutes().toString().padStart(2, '0') + ':' + updateTime.getSeconds().toString().padStart(2, '0');
    } else {
        lastUpdateEl.textContent = 'N/A';
    }
}

function updateEspModeDisplay(modeStringFromServer) {
    // This function now updates the sensorModeSelector dropdown
    if (modeStringFromServer && DOM.sensorModeSelector) {
        let modeValueToSelect = "0"; // Default to "All Sensors" (value "0")

        switch (modeStringFromServer.toUpperCase()) {
            case "ALL": modeValueToSelect = "0"; break;
            case "OUTER": modeValueToSelect = "1"; break;
            case "INNER": modeValueToSelect = "2"; break;
            default: modeValueToSelect = "0"; break;
        }
        if (DOM.sensorModeSelector.value !== modeValueToSelect) {
            DOM.sensorModeSelector.value = modeValueToSelect;
        }
    }
}
