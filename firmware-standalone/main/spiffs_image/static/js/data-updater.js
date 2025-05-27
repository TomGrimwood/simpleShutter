// data-updater.js - Enhanced for optimistic UI updates

// Helper to get a value from the config panel
function getConfigValue(id, defaultValue) {
    const element = document.getElementById(id);
    if (element) {
        const value = parseFloat(element.value);
        return isNaN(value) ? defaultValue : value;
    }
    return defaultValue;
}

// Helper to show/hide table rows based on a condition
// Assumes element is a cell (td) within the row to be shown/hidden
function setRowVisibilityByCellId(cellId, visible) {
    const cellElement = DOM[cellId] || document.getElementById(cellId);
    if (cellElement && cellElement.parentElement && cellElement.parentElement.tagName === 'TR') {
        cellElement.parentElement.style.display = visible ? '' : 'none';
    } else if (cellElement) { // If it's a direct element not in a TR, hide element itself
         cellElement.style.display = visible ? '' : 'none';
    }
}
// Helper to show/hide a whole section (identified by a header cell)
function setSectionVisibilityByHeaderId(headerCellId, visible) {
     const headerElement = document.getElementById(headerCellId); // Assuming headers don't have DOM entries
    if (headerElement && headerElement.parentElement && headerElement.parentElement.tagName === 'TR') {
        let currentRow = headerElement.parentElement;
        // Hide header row
        currentRow.style.display = visible ? '' : 'none';
        // Iterate to hide subsequent data rows until next section-header or end of table
        currentRow = currentRow.nextElementSibling;
        while(currentRow) {
            if (currentRow.querySelector('.section-header')) break; // Stop at next section
            currentRow.style.display = visible ? '' : 'none';
            currentRow = currentRow.nextElementSibling;
        }
    }
}


function updateShutterDisplay(rawData) {
    if (!rawData || typeof rawData.mode === 'undefined') {
        console.error("updateShutterDisplay: Invalid or missing rawData from ESP32.");
        return;
    }
    const currentDisplayMode = String(rawData.mode).toUpperCase();

    // --- Optimistic UI Structure Update based on Mode ---
    // This section adjusts visibility of table parts based on the current mode,
    // even if detailed data isn't available yet (e.g., during an optimistic update).

    const showS1 = (currentDisplayMode === "ALL" || currentDisplayMode === "OUTER");
    const showS2 = (currentDisplayMode === "ALL" || currentDisplayMode === "INNER");
    const showS3 = (currentDisplayMode === "ALL" || currentDisplayMode === "OUTER");

    // Exposure & Shutter Speed Rows (first data row in each section)
    setRowVisibilityByCellId('exp_ms_s1', true); // The row containing these cells
    setRowVisibilityByCellId('hz_s1', true);

    // Individual cells for S1, S2, S3 in Exposure/Hz tables
    if (DOM.exp_ms_s1) DOM.exp_ms_s1.style.visibility = showS1 ? 'visible' : 'hidden';
    if (DOM.hz_s1) DOM.hz_s1.style.visibility = showS1 ? 'visible' : 'hidden';
    if (DOM.exp_compare_s1s2) DOM.exp_compare_s1s2.style.visibility = (showS1 && showS2) ? 'visible' : 'hidden';

    if (DOM.exp_ms_s2) DOM.exp_ms_s2.style.visibility = showS2 ? 'visible' : 'hidden';
    if (DOM.hz_s2) DOM.hz_s2.style.visibility = showS2 ? 'visible' : 'hidden';
    if (DOM.exp_compare_s2s3) DOM.exp_compare_s2s3.style.visibility = (showS2 && showS3) ? 'visible' : 'hidden';

    if (DOM.exp_ms_s3) DOM.exp_ms_s3.style.visibility = showS3 ? 'visible' : 'hidden';
    if (DOM.hz_s3) DOM.hz_s3.style.visibility = showS3 ? 'visible' : 'hidden';

    // Curtain Travel Times section
    // S1-S2 and S2-S3 segments are only for "ALL"
    const showAllSegments = currentDisplayMode === "ALL";
    if (DOM.ct_c1_s1s2_time) DOM.ct_c1_s1s2_time.style.visibility = showAllSegments ? 'visible' : 'hidden';
    if (DOM.ct_c1_intra_pct_var) DOM.ct_c1_intra_pct_var.style.visibility = showAllSegments ? 'visible' : 'hidden';
    if (DOM.ct_c1_s2s3_time) DOM.ct_c1_s2s3_time.style.visibility = showAllSegments ? 'visible' : 'hidden';
    if (DOM.ct_c2_s1s2_time) DOM.ct_c2_s1s2_time.style.visibility = showAllSegments ? 'visible' : 'hidden';
    if (DOM.ct_c2_intra_pct_var) DOM.ct_c2_intra_pct_var.style.visibility = showAllSegments ? 'visible' : 'hidden';
    if (DOM.ct_c2_s2s3_time) DOM.ct_c2_s2s3_time.style.visibility = showAllSegments ? 'visible' : 'hidden';
    
    if (DOM.ct_c1c2_s1s2_compare_pct) DOM.ct_c1c2_s1s2_compare_pct.style.visibility = showAllSegments ? 'visible' : 'hidden';
    if (DOM.ct_c1c2_s2s3_compare_pct) DOM.ct_c1c2_s2s3_compare_pct.style.visibility = showAllSegments ? 'visible' : 'hidden';

    // Total S1-S3 travel is for "ALL" or "OUTER"
    const showTotalTravel = (currentDisplayMode === "ALL" || currentDisplayMode === "OUTER");
    if (DOM.ct_c1_total_time) DOM.ct_c1_total_time.style.visibility = showTotalTravel ? 'visible' : 'hidden';
    if (DOM.ct_c2_total_time) DOM.ct_c2_total_time.style.visibility = showTotalTravel ? 'visible' : 'hidden';
    if (DOM.ct_c1c2_total_compare_pct) DOM.ct_c1c2_total_compare_pct.style.visibility = showTotalTravel ? 'visible' : 'hidden';


    // Raw Sensor Timestamps Rows
    setRowVisibilityByCellId('raw_s1', showS1);
    setRowVisibilityByCellId('raw_s2', showS2);
    setRowVisibilityByCellId('raw_s3', showS3);

    // Clear previous client-side calculation errors
    if (DOM.errorDisplay && DOM.errorDisplay.innerHTML.includes("CLIENT CALC ERROR")) {
        DOM.errorDisplay.innerHTML = '';
    }
    
    const errors = []; 

    // --- 0. Get Configuration for Calculations ---
    const totalSensorDistanceMm = getConfigValue('totalSensorDistanceConfig', 30.0);
    const timeScalingFactor = getCurrentTimeScalingFactor(); 

    // --- 1. Raw times (already in µs from ESP32) ---
    // Use nullish coalescing or check if properties exist in rawData before assigning
    const s1_o_us = rawData.s1_open_us ?? null;
    const s1_c_us = rawData.s1_close_us ?? null;
    const s2_o_us = rawData.s2_open_us ?? null;
    const s2_c_us = rawData.s2_close_us ?? null;
    const s3_o_us = rawData.s3_open_us ?? null;
    const s3_c_us = rawData.s3_close_us ?? null;

    const selectedUnit = DOM.timestampUnitSelector.value;
    setText('raw_s1', formatRawTimestamp(s1_o_us, selectedUnit) + ' / ' + formatRawTimestamp(s1_c_us, selectedUnit));
    setText('raw_s2', formatRawTimestamp(s2_o_us, selectedUnit) + ' / ' + formatRawTimestamp(s2_c_us, selectedUnit));
    setText('raw_s3', formatRawTimestamp(s3_o_us, selectedUnit) + ' / ' + formatRawTimestamp(s3_c_us, selectedUnit));

    // --- 2. Exposure Times (calculate in µs, then convert to ms for display) ---
    const getExposureUs = (open_us, close_us) => (open_us != null && close_us != null && open_us > 0 && close_us > open_us) ? (close_us - open_us) : 0;
    
    let exp_us_s1 = 0, exp_us_s2 = 0, exp_us_s3 = 0;

    if (currentDisplayMode === "ALL" || currentDisplayMode === "OUTER") {
        exp_us_s1 = getExposureUs(s1_o_us, s1_c_us);
        if (s1_o_us > 0 && s1_c_us > 0 && s1_c_us <= s1_o_us && s1_o_us !== s1_c_us) errors.push("S1: Close time before or at open time.");
    }
    if (currentDisplayMode === "ALL" || currentDisplayMode === "INNER") {
        exp_us_s2 = getExposureUs(s2_o_us, s2_c_us);
        if (s2_o_us > 0 && s2_c_us > 0 && s2_c_us <= s2_o_us && s2_o_us !== s2_c_us) errors.push("S2: Close time before or at open time.");
    }
    if (currentDisplayMode === "ALL" || currentDisplayMode === "OUTER") {
        exp_us_s3 = getExposureUs(s3_o_us, s3_c_us);
        if (s3_o_us > 0 && s3_c_us > 0 && s3_c_us <= s3_o_us && s3_o_us !== s3_c_us) errors.push("S3: Close time before or at open time.");
    }
    
    const exp_ms_s1 = exp_us_s1 > 0 ? exp_us_s1 / 1000.0 : null;
    const exp_ms_s2 = exp_us_s2 > 0 ? exp_us_s2 / 1000.0 : null;
    const exp_ms_s3 = exp_us_s3 > 0 ? exp_us_s3 / 1000.0 : null;

    setText('exp_ms_s1', showS1 ? exp_ms_s1 : null, 3);
    setText('exp_ms_s2', showS2 ? exp_ms_s2 : null, 3);
    setText('exp_ms_s3', showS3 ? exp_ms_s3 : null, 3);
    if (showS1 && showS2) calculateAndDisplayComparison(exp_ms_s1, exp_ms_s2, 'exp_compare_s1s2'); else setText('exp_compare_s1s2', null);
    if (showS2 && showS3) calculateAndDisplayComparison(exp_ms_s2, exp_ms_s3, 'exp_compare_s2s3'); else setText('exp_compare_s2s3', null);


    // --- 3. Shutter Speeds (Hz equivalent = 1 / exposure_seconds) ---
    const getHz = (exp_us) => (exp_us > 0) ? (1.0 / (exp_us / 1000000.0)) : null;
    const hz_s1_val = getHz(exp_us_s1);
    const hz_s2_val = getHz(exp_us_s2);
    const hz_s3_val = getHz(exp_us_s3);

    setText('hz_s1', showS1 ? hz_s1_val : null, (hz_s1_val !== null && isFinite(hz_s1_val)) ? 2 : undefined);
    setText('hz_s2', showS2 ? hz_s2_val : null, (hz_s2_val !== null && isFinite(hz_s2_val)) ? 2 : undefined);
    setText('hz_s3', showS3 ? hz_s3_val : null, (hz_s3_val !== null && isFinite(hz_s3_val)) ? 2 : undefined);

    // --- 4. Average Exposure and Hz ---
    let validExposuresMs = [];
    if (showS1 && exp_ms_s1 !== null) validExposuresMs.push(exp_ms_s1);
    if (showS2 && exp_ms_s2 !== null) validExposuresMs.push(exp_ms_s2);
    if (showS3 && exp_ms_s3 !== null) validExposuresMs.push(exp_ms_s3);
    
    let avgExpMs = null;
    if (validExposuresMs.length > 0) {
        avgExpMs = validExposuresMs.reduce((a, b) => a + b, 0) / validExposuresMs.length;
    }
    setText('exp_ms_avg', avgExpMs, 3);

    let validHz = [];
    function parseHz(val) { return (val !== null && isFinite(val)) ? val : null; }
    let h1 = parseHz(hz_s1_val); let h2 = parseHz(hz_s2_val); let h3 = parseHz(hz_s3_val);
    if (showS1 && h1 !== null) validHz.push(h1);
    if (showS2 && h2 !== null) validHz.push(h2);
    if (showS3 && h3 !== null) validHz.push(h3);
    
    let avgHz = null;
    if (validHz.length > 0) {
        avgHz = validHz.reduce((a, b) => a + b, 0) / validHz.length;
    }
    setText('hz_avg', avgHz, 2);
    
    // --- 5. Curtain Travel Times ---
    let c1_s1s2_us = 0, c1_s2s3_us = 0, c1_s1s3_us = 0;
    let c2_s1s2_us = 0, c2_s2s3_us = 0, c2_s1s3_us = 0;

    if (currentDisplayMode === "ALL" || currentDisplayMode === "OUTER") {
        if (s1_o_us > 0 && s3_o_us > s1_o_us) c1_s1s3_us = s3_o_us - s1_o_us;
        else if (s1_o_us > 0 && s3_o_us > 0 && s1_o_us !== s3_o_us) errors.push("C1: S3 open not after S1 open.");
        
        if (s1_c_us > 0 && s3_c_us > s1_c_us) c2_s1s3_us = s3_c_us - s1_c_us;
        else if (s1_c_us > 0 && s3_c_us > 0 && s1_c_us !== s3_c_us) errors.push("C2: S3 close not after S1 close.");
    }
    if (currentDisplayMode === "ALL") {
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
    setText('ct_c1_s1s2_time', showAllSegments ? c1_s1s2_scaled_ms : null, 3);
    setText('ct_c1_s2s3_time', showAllSegments ? c1_s2s3_scaled_ms : null, 3);
    setText('ct_c1_total_time', showTotalTravel ? c1_total_scaled_ms : null, 3);
    if (showAllSegments) calculateAndDisplayComparison(c1_s1s2_scaled_ms, c1_s2s3_scaled_ms, 'ct_c1_intra_pct_var');
    else setText('ct_c1_intra_pct_var', null);

    const c2_s1s2_scaled_ms = toScaledMs(c2_s1s2_us);
    const c2_s2s3_scaled_ms = toScaledMs(c2_s2s3_us);
    const c2_total_scaled_ms = toScaledMs(c2_s1s3_us);
    setText('ct_c2_s1s2_time', showAllSegments ? c2_s1s2_scaled_ms : null, 3);
    setText('ct_c2_s2s3_time', showAllSegments ? c2_s2s3_scaled_ms : null, 3);
    setText('ct_c2_total_time', showTotalTravel ? c2_total_scaled_ms : null, 3);
    if (showAllSegments) calculateAndDisplayComparison(c2_s1s2_scaled_ms, c2_s2s3_scaled_ms, 'ct_c2_intra_pct_var');
    else setText('ct_c2_intra_pct_var', null);

    if (showAllSegments) {
        calculateAndDisplayComparison(c1_s1s2_scaled_ms, c2_s1s2_scaled_ms, 'ct_c1c2_s1s2_compare_pct');
        calculateAndDisplayComparison(c1_s2s3_scaled_ms, c2_s2s3_scaled_ms, 'ct_c1c2_s2s3_compare_pct');
    } else {
        setText('ct_c1c2_s1s2_compare_pct', null);
        setText('ct_c1c2_s2s3_compare_pct', null);
    }
    if (showTotalTravel) {
        calculateAndDisplayComparison(c1_total_scaled_ms, c2_total_scaled_ms, 'ct_c1c2_total_compare_pct');
    } else {
         setText('ct_c1c2_total_compare_pct', null);
    }

    // --- 6. Shutter Fully Open Duration & Slit Width ---
    setText('open_time_duration_ms', avgExpMs, 3); 

    let avg_slit_width_mm = null;
    if (avgExpMs !== null && avgExpMs > 0 && totalSensorDistanceMm > 0 && timeScalingFactor > 0) {
        const avg_exp_s = avgExpMs / 1000.0;
        const avg_c_total_s = (showTotalTravel && c1_s1s3_us > 0) ? (c1_s1s3_us * timeScalingFactor / 1000000.0) :
                              ((showTotalTravel && c2_s1s3_us > 0) ? (c2_s1s3_us * timeScalingFactor / 1000000.0) : 0);
        
        if (avg_c_total_s > 0) {
            avg_slit_width_mm = totalSensorDistanceMm * avg_exp_s / avg_c_total_s;
        } else if (showTotalTravel) { 
            errors.push("Cannot calculate slit width: Avg curtain travel time is zero or S1-S3 not active/valid.");
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

    // --- Display errors ---
    if (DOM.errorDisplay && errors.length > 0) {
        var errorHtml = DOM.errorDisplay.innerHTML; 
        if (!errorHtml.includes("Calculation Issues")) errorHtml = ""; 
        errorHtml += '<p class="error-message">CLIENT CALC ERROR:</p><ul>';
        errors.forEach(function(err) { errorHtml += '<li class="error-message">' + err + '</li>'; });
        errorHtml += '</ul>';
        DOM.errorDisplay.innerHTML = errorHtml;
    }
    
    if (typeof addResultToLog === 'function' && 
        (s1_o_us || s1_c_us || s2_o_us || s2_c_us || s3_o_us || s3_c_us) ) { // Only log if there's some actual data
         addResultToLog();
    }
}


function updateEsp32Status(isConnected, message, lastSeenTimestamp) {
    if (DOM.esp32ConnectionStatus) {
        DOM.esp32ConnectionStatus.textContent = message || (isConnected ? "Connected" : "Disconnected / Error");
        DOM.esp32ConnectionStatus.className = 'data-value '; 
        if (isConnected) {
            DOM.esp32ConnectionStatus.classList.add('esp32-connected');
        } else {
             DOM.esp32ConnectionStatus.classList.add('esp32-disconnected');
        }
    }
    if (DOM.lastUpdate) {
        if (lastSeenTimestamp && isConnected) { // Only update timestamp if connected
            const updateTime = new Date(lastSeenTimestamp);
            DOM.lastUpdate.textContent = updateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        } else if (!isConnected) {
             DOM.lastUpdate.textContent = 'N/A';
        }
        // If connected but no timestamp, don't change it.
    }
}

function updateEspModeDisplay(modeStringFromServer) {
    if (modeStringFromServer && DOM.sensorModeSelector) {
        let modeValueToSelect = "0"; 
        switch (String(modeStringFromServer).toUpperCase()) {
            case "ALL": modeValueToSelect = "0"; break;
            case "OUTER": modeValueToSelect = "1"; break;
            case "INNER": modeValueToSelect = "2"; break;
            case "UNKNOWN": 
            default: modeValueToSelect = "0"; break;
        }
        if (DOM.sensorModeSelector.value !== modeValueToSelect) {
            DOM.sensorModeSelector.value = modeValueToSelect;
        }
    }
}