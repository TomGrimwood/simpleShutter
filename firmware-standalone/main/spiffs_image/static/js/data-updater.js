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
    const timeScalingFactor = getCurrentTimeScalingFactor(); 

    // --- 1. Raw times (already in µs from ESP32) ---
    const s1_o_us = rawData.s1_open_us ?? null;
    const s1_c_us = rawData.s1_close_us ?? null;
    const s2_o_us = rawData.s2_open_us ?? null;
    const s2_c_us = rawData.s2_close_us ?? null;
    const s3_o_us = rawData.s3_open_us ?? null;
    const s3_c_us = rawData.s3_close_us ?? null;

    const selectedUnit = DOM.timestampUnitSelector.value;
    // formatRawTimestamp now includes units, so setText does not need a unit parameter for these
    setText('raw_s1', formatRawTimestamp(s1_o_us, selectedUnit) + ' / ' + formatRawTimestamp(s1_c_us, selectedUnit));
    setText('raw_s2', formatRawTimestamp(s2_o_us, selectedUnit) + ' / ' + formatRawTimestamp(s2_c_us, selectedUnit));
    setText('raw_s3', formatRawTimestamp(s3_o_us, selectedUnit) + ' / ' + formatRawTimestamp(s3_c_us, selectedUnit));

    // --- 2. Exposure Times (calculate in µs, then convert to ms for display) ---
    const getExposureUs = (open_us, close_us) => (open_us != null && close_us != null && open_us > 0 && close_us > open_us) ? (close_us - open_us) : 0;
    
    let exp_us_s1 = 0, exp_us_s2 = 0, exp_us_s3 = 0;

    if (showS1) {
        exp_us_s1 = getExposureUs(s1_o_us, s1_c_us);
        if (s1_o_us > 0 && s1_c_us > 0 && s1_c_us <= s1_o_us && s1_o_us !== s1_c_us) errors.push("S1: Close time before or at open time.");
    }
    if (showS2) {
        exp_us_s2 = getExposureUs(s2_o_us, s2_c_us);
        if (s2_o_us > 0 && s2_c_us > 0 && s2_c_us <= s2_o_us && s2_o_us !== s2_c_us) errors.push("S2: Close time before or at open time.");
    }
    if (showS3) {
        exp_us_s3 = getExposureUs(s3_o_us, s3_c_us);
        if (s3_o_us > 0 && s3_c_us > 0 && s3_c_us <= s3_o_us && s3_o_us !== s3_c_us) errors.push("S3: Close time before or at open time.");
    }
    
    const exp_ms_s1 = exp_us_s1 > 0 ? exp_us_s1 / 1000.0 : null;
    const exp_ms_s2 = exp_us_s2 > 0 ? exp_us_s2 / 1000.0 : null;
    const exp_ms_s3 = exp_us_s3 > 0 ? exp_us_s3 / 1000.0 : null;

    setText('exp_ms_s1', showS1 ? exp_ms_s1 : null, 3, ' ms');
    setText('exp_ms_s2', showS2 ? exp_ms_s2 : null, 3, ' ms');
    setText('exp_ms_s3', showS3 ? exp_ms_s3 : null, 3, ' ms');
    if (showS1 && showS2) calculateAndDisplayComparison(exp_ms_s1, exp_ms_s2, 'exp_compare_s1s2'); else setText('exp_compare_s1s2', null);
    if (showS2 && showS3) calculateAndDisplayComparison(exp_ms_s2, exp_ms_s3, 'exp_compare_s2s3'); else setText('exp_compare_s2s3', null);

    // --- 3. Shutter Speeds (Hz equivalent = 1 / exposure_seconds) ---
    const getHz = (exp_us) => (exp_us > 0) ? (1.0 / (exp_us / 1000000.0)) : null;
    const hz_s1_val = getHz(exp_us_s1);
    const hz_s2_val = getHz(exp_us_s2);
    const hz_s3_val = getHz(exp_us_s3);

    setText('hz_s1', showS1 ? hz_s1_val : null, (hz_s1_val !== null && isFinite(hz_s1_val)) ? 2 : undefined, ' Hz');
    setText('hz_s2', showS2 ? hz_s2_val : null, (hz_s2_val !== null && isFinite(hz_s2_val)) ? 2 : undefined, ' Hz');
    setText('hz_s3', showS3 ? hz_s3_val : null, (hz_s3_val !== null && isFinite(hz_s3_val)) ? 2 : undefined, ' Hz');

    // --- 4. Average Exposure and Hz ---
    let validExposuresMs = [];
    if (showS1 && exp_ms_s1 !== null) validExposuresMs.push(exp_ms_s1);
    if (showS2 && exp_ms_s2 !== null) validExposuresMs.push(exp_ms_s2);
    if (showS3 && exp_ms_s3 !== null) validExposuresMs.push(exp_ms_s3);
    
    let avgExpMs = null;
    if (validExposuresMs.length > 0) {
        avgExpMs = validExposuresMs.reduce((a, b) => a + b, 0) / validExposuresMs.length;
    }
    setText('exp_ms_avg', avgExpMs, 3, ' ms');

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
    setText('hz_avg', avgHz, 2, ' Hz');
    
    // --- 5. Curtain Travel Times ---
    let c1_s1s2_us = 0, c1_s2s3_us = 0, c1_s1s3_us = 0;
    let c2_s1s2_us = 0, c2_s2s3_us = 0, c2_s1s3_us = 0;

    if (showTotalTravel) { // S1-S3 calculations
        if (s1_o_us > 0 && s3_o_us > s1_o_us) c1_s1s3_us = s3_o_us - s1_o_us;
        else if (s1_o_us > 0 && s3_o_us > 0 && s1_o_us !== s3_o_us) errors.push("C1: S3 open not after S1 open for total travel.");
        
        if (s1_c_us > 0 && s3_c_us > s1_c_us) c2_s1s3_us = s3_c_us - s1_c_us;
        else if (s1_c_us > 0 && s3_c_us > 0 && s1_c_us !== s3_c_us) errors.push("C2: S3 close not after S1 close for total travel.");
    }
    if (showAllSegments) { // S1-S2 and S2-S3 calculations
        if (s1_o_us > 0 && s2_o_us > s1_o_us) c1_s1s2_us = s2_o_us - s1_o_us;
        else if (s1_o_us > 0 && s2_o_us > 0 && s1_o_us !== s2_o_us) errors.push("C1: S2 open not after S1 open for segment.");
        
        if (s2_o_us > 0 && s3_o_us > s2_o_us) c1_s2s3_us = s3_o_us - s2_o_us;
        else if (s2_o_us > 0 && s3_o_us > 0 && s2_o_us !== s3_o_us) errors.push("C1: S3 open not after S2 open for segment.");
        
        if (s1_c_us > 0 && s2_c_us > s1_c_us) c2_s1s2_us = s2_c_us - s1_c_us;
        else if (s1_c_us > 0 && s2_c_us > 0 && s1_c_us !== s2_c_us) errors.push("C2: S2 close not after S1 close for segment.");
        
        if (s2_c_us > 0 && s3_c_us > s2_c_us) c2_s2s3_us = s3_c_us - s2_c_us;
        else if (s2_c_us > 0 && s3_c_us > 0 && s2_c_us !== s3_c_us) errors.push("C2: S3 close not after S2 close for segment.");
    }
    
    const toScaledMs = (val_us) => (val_us > 0) ? (val_us * timeScalingFactor / 1000.0) : null;

    const c1_s1s2_scaled_ms = toScaledMs(c1_s1s2_us);
    const c1_s2s3_scaled_ms = toScaledMs(c1_s2s3_us);
    const c1_total_scaled_ms = toScaledMs(c1_s1s3_us); 
    setText('ct_c1_s1s2_time', showAllSegments ? c1_s1s2_scaled_ms : null, 3, ' ms');
    setText('ct_c1_s2s3_time', showAllSegments ? c1_s2s3_scaled_ms : null, 3, ' ms');
    setText('ct_c1_total_time', showTotalTravel ? c1_total_scaled_ms : null, 3, ' ms');
    if (showAllSegments) calculateAndDisplayComparison(c1_s1s2_scaled_ms, c1_s2s3_scaled_ms, 'ct_c1_intra_pct_var');
    else setText('ct_c1_intra_pct_var', null);

    const c2_s1s2_scaled_ms = toScaledMs(c2_s1s2_us);
    const c2_s2s3_scaled_ms = toScaledMs(c2_s2s3_us);
    const c2_total_scaled_ms = toScaledMs(c2_s1s3_us);
    setText('ct_c2_s1s2_time', showAllSegments ? c2_s1s2_scaled_ms : null, 3, ' ms');
    setText('ct_c2_s2s3_time', showAllSegments ? c2_s2s3_scaled_ms : null, 3, ' ms');
    setText('ct_c2_total_time', showTotalTravel ? c2_total_scaled_ms : null, 3, ' ms');
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

// --- 6. Full Open Duration & Slit Width ---
    const frameHeightMm = getConfigValue('calibrationTargetDistanceConfig', null); // Get configured frame height, default to null

    let fullOpenDurationMs = null;
    // Calculate Full Open Duration if possible
    // Prerequisites: avgExpMs is a valid number, c1_total_scaled_ms is a positive number.
    if (avgExpMs !== null && typeof avgExpMs === 'number' &&
        c1_total_scaled_ms !== null && typeof c1_total_scaled_ms === 'number' && c1_total_scaled_ms > 0) {
        fullOpenDurationMs = Math.max(0, avgExpMs - c1_total_scaled_ms);
    } else {
        // Add errors if Full Open Duration cannot be calculated due to missing/invalid components
        if (avgExpMs === null && (showS1 || showS2 || showS3)) { // avgExpMs is required
            // Avoid adding duplicate error if already present from other calculations
            if (!errors.some(e => e.includes("Average Exposure Time"))) {
                errors.push("Full Open Duration: Average Exposure Time is unavailable.");
            }
        } else if (avgExpMs !== null && showTotalTravel && (c1_total_scaled_ms === null || c1_total_scaled_ms <= 0)) {
            // c1_total_scaled_ms is required if showTotalTravel is true and avgExpMs is present
            if (!errors.some(e => e.includes("C1 Total Travel Time"))) {
                 errors.push("Full Open Duration: C1 Total Travel Time (scaled) is zero, negative, or unavailable.");
            }
        }
    }
    // Display Full Open Duration. Show 0.00 for 0ms, otherwise default (3dp).
    setText('open_time_duration_ms', fullOpenDurationMs, (fullOpenDurationMs === 0 ? 2 : 3), ' ms');

    let effectiveSlitWidthMm = null;
    // Calculate Effective Slit Width if possible
    // Prerequisites: frameHeightMm > 0, avgExpMs >= 0, c1_total_scaled_ms > 0.
    if (frameHeightMm === null || typeof frameHeightMm !== 'number' || frameHeightMm <= 0) {
        if (!errors.some(e => e.includes("Frame Height"))) {
            errors.push("Slit Width: Frame Height (Actual S1-S3 Dist.) must be positive and configured.");
        }
    } else if (avgExpMs === null || typeof avgExpMs !== 'number' || avgExpMs < 0) {
        // Only push error if exposure data was generally expected for the current mode
        if (showS1 || showS2 || showS3) {
            if (!errors.some(e => e.includes("Average Exposure Time"))) {
                errors.push("Slit Width: Average Exposure Time is invalid or unavailable.");
            }
        }
    } else if (c1_total_scaled_ms === null || typeof c1_total_scaled_ms !== 'number' || c1_total_scaled_ms <= 0) {
        // Only push error if C1 travel time was expected for the current mode and avgExpMs is valid
        if (showTotalTravel && avgExpMs !== null) {
             if (!errors.some(e => e.includes("C1 Total Travel Time"))) {
                errors.push("Slit Width: C1 Total Travel Time (scaled) is zero, negative, or unavailable.");
            }
        }
    } else {
        // All direct inputs (frameHeightMm, avgExpMs, c1_total_scaled_ms) are valid for slit width calculation.
        // We can use the already calculated fullOpenDurationMs or re-derive its logic here for clarity.
        // For consistency, let's use the logic for full open duration directly:
        const currentFullOpenDuration = Math.max(0, avgExpMs - c1_total_scaled_ms);

        if (currentFullOpenDuration > 0) {
            // Frame was fully open. Effective slit width is the full frame height.
            effectiveSlitWidthMm = null;
        } else { // currentFullOpenDuration is 0 (i.e., avgExpMs <= c1_total_scaled_ms)
            // Frame was not fully open, or exactly at the boundary.
            const calculatedSlitWidth = (frameHeightMm / c1_total_scaled_ms) * avgExpMs;
            // avgExpMs can be 0, resulting in 0 slit width.
            // Since avgExpMs <= c1_total_scaled_ms, calculatedSlitWidth will be <= frameHeightMm.
            effectiveSlitWidthMm = Math.max(0, calculatedSlitWidth); // Ensure non-negative.
        }
    }
    setText('slit_width_mm', effectiveSlitWidthMm, 2, ' mm');


    // --- 7. Exposure Variation % ---
    let exp_var_pct = null;
    if (validExposuresMs.length > 1 && avgExpMs !== null && avgExpMs > 0) {
        let sumOfSquares = 0;
        validExposuresMs.forEach(exp => { sumOfSquares += Math.pow(exp - avgExpMs, 2); });
        const stdDev = Math.sqrt(sumOfSquares / validExposuresMs.length);
        exp_var_pct = (stdDev / avgExpMs) * 100.0;
    }
    // Pass unit with leading space for consistency
    setText('exp_var_pct', exp_var_pct, 2, (exp_var_pct === null || !isFinite(exp_var_pct)) ? '' : ' %');


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
        (s1_o_us || s1_c_us || s2_o_us || s2_c_us || s3_o_us || s3_c_us) ) { 
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
        if (lastSeenTimestamp && isConnected) { 
            const updateTime = new Date(lastSeenTimestamp);
            DOM.lastUpdate.textContent = updateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        } else if (!isConnected) {
             DOM.lastUpdate.textContent = 'N/A';
        }
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