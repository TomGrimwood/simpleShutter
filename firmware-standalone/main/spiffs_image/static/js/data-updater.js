// data-updater.js
// Depends on ui-helpers.js for DOM access, setText, formatRawTimestamp, updateSystemStatus
// Depends on config-panel.js for getCurrentTimeScalingFactor
// Depends on shutter-calcs.js for calculateAndDisplayComparison
// Depends on results-log.js for addResultToStagingArea (or addResultToLog in original)

// Helper function to get a configuration value.
// It now directly gets the element from the DOM.
function getConfigValue(id, defaultValue) {
    const element = document.getElementById(id); // Get element directly by ID
    if (element && element.value !== undefined) {
        const value = parseFloat(element.value);
        return isNaN(value) ? defaultValue : value;
    }
    // Only log a warning if the element is genuinely not found,
    // not just because DOM wasn't fully ready when DOM object was built.
    // This warning might still fire if the ID is wrong or the element is truly missing.
    // console.warn(`Config element ${id} not found.`); // Keep this commented unless needed for debugging missing elements
    return defaultValue;
}

// Helper function to set visibility of a row based on a cell's visibility
function setRowVisibilityByCellId(cellId, visible) {
    // Use document.getElementById directly here as well for robustness
    const cell = document.getElementById(cellId);
    if (cell) {
        const row = cell.closest('tr');
        if (row) row.style.display = visible ? '' : 'none';
    } else {
        console.warn(`Cell element ${cellId} not found for row visibility.`);
    }
}


function updateShutterDisplay(rawData) {
    if (!rawData || typeof rawData.mode === 'undefined') {
        console.error("updateShutterDisplay: Invalid or missing rawData from ESP32.");
        if (DOM.errorDisplay) DOM.errorDisplay.innerHTML = '<p class="error-message">Error: Invalid data received from device.</p>';
        return;
    }

    // Ensure necessary UI helper functions and DOM elements are available
    // Reduced the number of checks here as the core issue was element retrieval in getConfigValue/setRowVisibility
    if (typeof setText !== 'function' || typeof formatRawTimestamp !== 'function' || typeof updateSystemStatus !== 'function' ||
        typeof calculateAndDisplayComparison !== 'function' || typeof addResultToStagingArea !== 'function' || typeof getCurrentTimeScalingFactor !== 'function' ||
        !DOM.timestampUnitSelector || !DOM.errorDisplay || !DOM.sensorModeSelector) {
        console.error("Data updater initialization failed: Missing core helper functions or critical DOM elements.");
        if (DOM.errorDisplay) DOM.errorDisplay.innerHTML = '<p class="error-message">Error: UI components missing for display update.</p>';
        return;
    }


    const currentDisplayMode = String(rawData.mode).toUpperCase();
    const showS1 = (currentDisplayMode === "ALL" || currentDisplayMode === "OUTER");
    const showS2 = (currentDisplayMode === "ALL" || currentDisplayMode === "INNER");
    const showS3 = (currentDisplayMode === "ALL" || currentDisplayMode === "OUTER");

    // Update visibility of table cells/rows based on mode
    // Ensure DOM elements exist before trying to set style.visibility
    if (DOM.exp_ms_s1) DOM.exp_ms_s1.style.visibility = showS1 ? 'visible' : 'hidden';
    if (DOM.hz_s1) DOM.hz_s1.style.visibility = showS1 ? 'visible' : 'hidden';
    if (DOM.exp_compare_s1s2) DOM.exp_compare_s1s2.style.visibility = (showS1 && showS2) ? 'visible' : 'hidden';
    if (DOM.exp_ms_s2) DOM.exp_ms_s2.style.visibility = showS2 ? 'visible' : 'hidden';
    if (DOM.hz_s2) DOM.hz_s2.style.visibility = showS2 ? 'visible' : 'hidden';
    if (DOM.exp_compare_s2s3) DOM.exp_compare_s2s3.style.visibility = (showS2 && showS3) ? 'visible' : 'hidden';
    if (DOM.exp_ms_s3) DOM.exp_ms_s3.style.visibility = showS3 ? 'visible' : 'hidden';
    if (DOM.hz_s3) DOM.hz_s3.style.visibility = showS3 ? 'visible' : 'hidden';

    const showAllSegments = currentDisplayMode === "ALL";
    if (DOM.ct_c1_s1s2_time) DOM.ct_c1_s1s2_time.style.visibility = showAllSegments ? 'visible' : 'hidden';
    if (DOM.ct_c1_intra_pct_var) DOM.ct_c1_intra_pct_var.style.visibility = showAllSegments ? 'visible' : 'hidden';
    if (DOM.ct_c1_s2s3_time) DOM.ct_c1_s2s3_time.style.visibility = showAllSegments ? 'visible' : 'hidden';
    if (DOM.ct_c2_s1s2_time) DOM.ct_c2_s1s2_time.style.visibility = showAllSegments ? 'visible' : 'hidden';
    if (DOM.ct_c2_intra_pct_var) DOM.ct_c2_intra_pct_var.style.visibility = showAllSegments ? 'visible' : 'hidden';
    if (DOM.ct_c2_s2s3_time) DOM.ct_c2_s2s3_time.style.visibility = showAllSegments ? 'visible' : 'hidden';
    if (DOM.ct_c1c2_s1s2_compare_pct) DOM.ct_c1c2_s1s2_compare_pct.style.visibility = showAllSegments ? 'visible' : 'hidden';
    if (DOM.ct_c1c2_s2s3_compare_pct) DOM.ct_c1c2_s2s3_compare_pct.style.visibility = showAllSegments ? 'visible' : 'hidden';

    const showTotalTravel = (currentDisplayMode === "ALL" || currentDisplayMode === "OUTER");
    if (DOM.ct_c1_total_time) DOM.ct_c1_total_time.style.visibility = showTotalTravel ? 'visible' : 'hidden';
    if (DOM.ct_c2_total_time) DOM.ct_c2_total_time.style.visibility = showTotalTravel ? 'visible' : 'hidden';
    if (DOM.ct_c1c2_total_compare_pct) DOM.ct_c1c2_total_compare_pct.style.visibility = showTotalTravel ? 'visible' : 'hidden';

    setRowVisibilityByCellId('raw_s1', showS1);
    setRowVisibilityByCellId('raw_s2', showS2);
    setRowVisibilityByCellId('raw_s3', showS3);

    // Clear previous errors if data is valid
    if (DOM.errorDisplay && DOM.errorDisplay.innerHTML.includes("CLIENT CALC ERROR")) DOM.errorDisplay.innerHTML = ''; // Keep client calc errors
    if (DOM.errorDisplay && DOM.errorDisplay.innerHTML.includes("DEVICE ERROR")) DOM.errorDisplay.innerHTML = DOM.errorDisplay.innerHTML.replace(/<p class="error-message">DEVICE ERROR.*?<\/p>/, ''); // Clear device errors

    const errors = [];
    const warnings = []; // <<< Added warnings array

    const timeScalingFactor = getCurrentTimeScalingFactor();
    const s1_o_us = rawData.s1_open_us ?? null, s1_c_us = rawData.s1_close_us ?? null;
    const s2_o_us = rawData.s2_open_us ?? null, s2_c_us = rawData.s2_close_us ?? null;
    const s3_o_us = rawData.s3_open_us ?? null, s3_c_us = rawData.s3_close_us ?? null;
    const selectedUnit = DOM.timestampUnitSelector.value;

    // Ensure raw timestamp elements exist
    if (DOM.raw_s1) setText('raw_s1', formatRawTimestamp(s1_o_us, selectedUnit) + ' / ' + formatRawTimestamp(s1_c_us, selectedUnit));
    if (DOM.raw_s2) setText('raw_s2', formatRawTimestamp(s2_o_us, selectedUnit) + ' / ' + formatRawTimestamp(s2_c_us, selectedUnit));
    if (DOM.raw_s3) setText('raw_s3', formatRawTimestamp(s3_o_us, selectedUnit) + ' / ' + formatRawTimestamp(s3_c_us, selectedUnit));


    const getExposureUs = (o, c) => (o != null && c != null && o > 0 && c > o) ? (c - o) : 0;
    let exp_us_s1 = 0, exp_us_s2 = 0, exp_us_s3 = 0;
    if (showS1) { exp_us_s1 = getExposureUs(s1_o_us, s1_c_us); if (s1_o_us > 0 && s1_c_us > 0 && s1_c_us <= s1_o_us) errors.push("S1: Close before/at open.");}
    if (showS2) { exp_us_s2 = getExposureUs(s2_o_us, s2_c_us); if (s2_o_us > 0 && s2_c_us > 0 && s2_c_us <= s2_o_us) errors.push("S2: Close before/at open.");}
    if (showS3) { exp_us_s3 = getExposureUs(s3_o_us, s3_c_us); if (s3_o_us > 0 && s3_c_us > 0 && s3_c_us <= s3_o_us) errors.push("S3: Close before/at open.");}


    const exp_ms_s1 = exp_us_s1 > 0 ? exp_us_s1 / 1000.0 : null;
    const exp_ms_s2 = exp_us_s2 > 0 ? exp_us_s2 / 1000.0 : null;
    const exp_ms_s3 = exp_us_s3 > 0 ? exp_us_s3 / 1000.0 : null;
    if (DOM.exp_ms_s1) setText('exp_ms_s1', showS1 ? exp_ms_s1 : null, 3, ' ms');
    if (DOM.exp_ms_s2) setText('exp_ms_s2', showS2 ? exp_ms_s2 : null, 3, ' ms');
    if (DOM.exp_ms_s3) setText('exp_ms_s3', showS3 ? exp_ms_s3 : null, 3, ' ms');
    if (DOM.exp_compare_s1s2) if (showS1 && showS2) calculateAndDisplayComparison(exp_ms_s1, exp_ms_s2, 'exp_compare_s1s2'); else setText('exp_compare_s1s2', '---');
    if (DOM.exp_compare_s2s3) if (showS2 && showS3) calculateAndDisplayComparison(exp_ms_s2, exp_ms_s3, 'exp_compare_s2s3'); else setText('exp_compare_s2s3', '---');

    const getHz = (exp_us) => (exp_us > 0) ? (1.0 / (exp_us / 1000000.0)) : null;
    const hz_s1_val = getHz(exp_us_s1);
    const hz_s2_val = getHz(exp_us_s2);
    const hz_s3_val = getHz(exp_us_s3);
    if (DOM.hz_s1) setText('hz_s1', showS1 ? hz_s1_val : null, (isFinite(hz_s1_val) ? 2:undefined), ' Hz');
    if (DOM.hz_s2) setText('hz_s2', showS2 ? hz_s2_val : null, (isFinite(hz_s2_val) ? 2:undefined), ' Hz');
    if (DOM.hz_s3) setText('hz_s3', showS3 ? hz_s3_val : null, (isFinite(hz_s3_val) ? 2:undefined), ' Hz');

    let validExposuresMs = [];
    if (showS1 && exp_ms_s1 != null && exp_ms_s1 > 0) validExposuresMs.push(exp_ms_s1);
    if (showS2 && exp_ms_s2 != null && exp_ms_s2 > 0) validExposuresMs.push(exp_ms_s2);
    if (showS3 && exp_ms_s3 != null && exp_ms_s3 > 0) validExposuresMs.push(exp_ms_s3);
    let avgExpMs = validExposuresMs.length > 0 ? validExposuresMs.reduce((a,b)=>a+b,0)/validExposuresMs.length : null;
    if (DOM.exp_ms_avg) setText('exp_ms_avg', avgExpMs, 3, ' ms');

    let validHzValues = [];
    if (showS1 && hz_s1_val != null && isFinite(hz_s1_val)) validHzValues.push(hz_s1_val);
    if (showS2 && hz_s2_val != null && isFinite(hz_s2_val)) validHzValues.push(hz_s2_val);
    if (showS3 && hz_s3_val != null && isFinite(hz_s3_val)) validHzValues.push(hz_s3_val);
    let avgHz = validHzValues.length > 0 ? validHzValues.reduce((a,b)=>a+b,0)/validHzValues.length : null;
    if (DOM.hz_avg) setText('hz_avg', avgHz, 2, ' Hz');

    let c1_s1s3=0, c2_s1s3=0, c1_s1s2=0, c1_s2s3=0, c2_s1s2=0, c2_s2s3=0;
    if(showTotalTravel){
        if(s1_o_us > 0 && s3_o_us > s1_o_us) c1_s1s3 = s3_o_us - s1_o_us; else if(s1_o_us > 0 && s3_o_us > 0) errors.push("C1: S3 open before S1 (total) or S3 open not detected."); // Adjusted error message
        if(s1_c_us > 0 && s3_c_us > s1_c_us) c2_s1s3 = s3_c_us - s1_c_us; else if(s1_c_us > 0 && s3_c_us > 0) errors.push("C2: S3 close before S1 (total) or S3 close not detected."); // Adjusted error message
    }
    if(showAllSegments){
        if(s1_o_us > 0 && s2_o_us > s1_o_us) c1_s1s2 = s2_o_us - s1_o_us; else if(s1_o_us > 0 && s2_o_us > 0) errors.push("C1: S2 open before S1 or S2 open not detected."); // Adjusted
        if(s2_o_us > 0 && s3_o_us > s2_o_us) c1_s2s3 = s3_o_us - s2_o_us; else if(s2_o_us > 0 && s3_o_us > 0) errors.push("C1: S3 open before S2 or S3 open not detected."); // Adjusted
        if(s1_c_us > 0 && s2_c_us > s1_c_us) c2_s1s2 = s2_c_us - s1_c_us; else if(s1_c_us > 0 && s2_c_us > 0) errors.push("C2: S2 close before S1 or S2 close not detected."); // Adjusted
        if(s2_c_us > 0 && s3_c_us > s2_c_us) c2_s2s3 = s3_c_us - s2_c_us; else if(s2_c_us > 0 && s3_c_us > 0) errors.push("C2: S3 close before S2 or S3 close not detected."); // Adjusted
    }

    const toScaledMs = (us) => (us > 0) ? (us * timeScalingFactor / 1000.0) : null;
    const c1s1s2t = toScaledMs(c1_s1s2), c1s2s3t = toScaledMs(c1_s2s3), c1s1s3t = toScaledMs(c1_s1s3);
    const c2s1s2t = toScaledMs(c2_s1s2), c2s2s3t = toScaledMs(c2_s2s3), c2s1s3t = toScaledMs(c2_s1s3);
     if (DOM.ct_c1_s1s2_time) setText('ct_c1_s1s2_time', showAllSegments ? c1s1s2t : null, 3, ' ms');
     if (DOM.ct_c1_s2s3_time) setText('ct_c1_s2s3_time', showAllSegments ? c1s2s3t : null, 3, ' ms');
     if (DOM.ct_c1_total_time) setText('ct_c1_total_time', showTotalTravel ? c1s1s3t : null, 3, ' ms');
    if(DOM.ct_c1_intra_pct_var) if(showAllSegments) calculateAndDisplayComparison(c1s1s2t, c1s2s3t, 'ct_c1_intra_pct_var'); else setText('ct_c1_intra_pct_var', '---');
     if (DOM.ct_c2_s1s2_time) setText('ct_c2_s1s2_time', showAllSegments ? c2s1s2t : null, 3, ' ms');
     if (DOM.ct_c2_s2s3_time) setText('ct_c2_s2s3_time', showAllSegments ? c2s2s3t : null, 3, ' ms');
     if (DOM.ct_c2_total_time) setText('ct_c2_total_time', showTotalTravel ? c2s1s3t : null, 3, ' ms');
    if(DOM.ct_c2_intra_pct_var) if(showAllSegments) calculateAndDisplayComparison(c2s1s2t, c2s2s3t, 'ct_c2_intra_pct_var'); else setText('ct_c2_intra_pct_var', '---');
    if(showAllSegments){
        if(DOM.ct_c1c2_s1s2_compare_pct) calculateAndDisplayComparison(c1s1s2t, c2s1s2t, 'ct_c1c2_s1s2_compare_pct');
        if(DOM.ct_c1c2_s2s3_compare_pct) calculateAndDisplayComparison(c1s2s3t, c2s2s3t, 'ct_c1c2_s2s3_compare_pct');
    } else { if(DOM.ct_c1c2_s1s2_compare_pct) setText('ct_c1c2_s1s2_compare_pct', '---'); if(DOM.ct_c1c2_s2s3_compare_pct) setText('ct_c1c2_s2s3_compare_pct', '---'); }
    if(DOM.ct_c1c2_total_compare_pct) if(showTotalTravel) calculateAndDisplayComparison(c1s1s3t, c2s1s3t, 'ct_c1c2_total_compare_pct'); else setText('ct_c1c2_total_compare_pct', '---');

    const frameHeightMm = getConfigValue('calibrationTargetDistanceConfig', null);
    let fullOpenDurMs = null;
    // Calculate full open duration: Exposure - Curtain Travel (total)
    // This requires both average exposure and total curtain travel
    if (avgExpMs != null && c1s1s3t != null && c1s1s3t > 0) {
        fullOpenDurMs = Math.max(0, avgExpMs - c1s1s3t);
    } else if (avgExpMs == null && (showS1||showS2||showS3)) { // Don't error if no sensors are active
         const expErrors = errors.filter(e => e.includes("Exp")).length;
         if (expErrors === 0) errors.push("Full Open: Avg Exp unavailable.");
    } else if (avgExpMs != null && showTotalTravel && (c1s1s3t == null || c1s1s3t <= 0)) {
         const c1TotalErrors = errors.filter(e => e.includes("C1 Total")).length;
         if (c1TotalErrors === 0) errors.push("Full Open: C1 Total Travel invalid or not detected.");
    }
     if (DOM.open_time_duration_ms) setText('open_time_duration_ms', fullOpenDurMs, (fullOpenDurMs === 0 ? 2:3), ' ms');


    // Calculate effective slit width: Frame Height / Total Curtain Travel * Exposure Time (average)
    let effSlitMm = null;
    if (frameHeightMm == null || frameHeightMm <= 0) {
        const frameHeightErrors = errors.filter(e => e.includes("Frame Height")).length;
        if(frameHeightErrors === 0) errors.push("Slit: Frame Height invalid (Config)."); // Add specific note about config
    } else if (avgExpMs == null || avgExpMs <= 0) { // Exposure must be positive
        const expErrors = errors.filter(e => e.includes("Exp")).length;
        if((showS1||showS2||showS3) && expErrors === 0) errors.push("Slit: Avg Exp invalid.");
    } else if (c1s1s3t == null || c1s1s3t <= 0) { // Curtain travel must be positive
        const c1TotalErrors = errors.filter(e => e.includes("C1 Total")).length;
        if(showTotalTravel && avgExpMs > 0 && c1TotalErrors === 0) errors.push("Slit: C1 Total Travel invalid or not detected.");
    }
    else {
        // If Full Open Duration is 0 or less (slit scan), calculate based on travel speed and exposure
         const currentFullOpenDur = Math.max(0, avgExpMs - c1s1s3t);
         if (currentFullOpenDur > 0) {
             // Slit is fully open. Indicate this instead of a slit width.
             // Maybe display "Full Frame" or similar? For now, setting to null.
             effSlitMm = null;
             // PUSH THIS MESSAGE TO WARNINGS, NOT ERRORS
             if (avgExpMs > 0 && c1s1s3t > 0) warnings.push(`Slit: Full open (${currentFullOpenDur.toFixed(3)} ms), slit width calculation not standard.`); // Adjusted message goes here
         } else {
              // Slit scan
             if (c1s1s3t > 0) { // Ensure travel time is valid and positive
                 effSlitMm = (frameHeightMm / c1s1s3t) * avgExpMs;
                 if (!isFinite(effSlitMm) || effSlitMm < 0) { effSlitMm = null; errors.push("Slit: Calculated slit width invalid."); }
             } else {
                  // Travel time is invalid, cannot calculate slit width
                   const c1TotalErrors = errors.filter(e => e.includes("C1 Total")).length;
                   if(c1TotalErrors === 0) errors.push("Slit: C1 Total Travel invalid or not detected.");
             }
         }
    }
    if (DOM.slit_width_mm) setText('slit_width_mm', showTotalTravel ? effSlitMm : null, 2, (isFinite(effSlitMm) ? ' mm':''));


    // Calculate exposure variation percentage
    let expVarPct = null;
    if (validExposuresMs.length > 1 && avgExpMs != null && avgExpMs > 0) {
        const stdDev = Math.sqrt(validExposuresMs.reduce((s,e)=>s+Math.pow(e-avgExpMs,2),0)/validExposuresMs.length);
        expVarPct = (stdDev / avgExpMs) * 100.0;
         if(!isFinite(expVarPct)) expVarPct = null; // Handle potential division by zero or other issues
    } else if (validExposuresMs.length > 0 && (avgExpMs == null || avgExpMs <= 0)) { // Check for invalid/zero average exposure
         const expErrors = errors.filter(e => e.includes("Exp")).length;
         if (expErrors === 0) errors.push("Exp Var: Average exposure invalid or zero.");
    } else if (validExposuresMs.length <= 1 && (showS1 || showS2 || showS3)) {
         // Only 0 or 1 sensor has valid exposure data, variance is not meaningful
         if (DOM.exp_var_pct) setText('exp_var_pct', 'N/A'); // Set explicitly to N/A instead of null/---
    } else {
         if (DOM.exp_var_pct) setText('exp_var_pct', '---'); // Default if no sensors are shown or no valid data at all
    }

    // If expVarPct was calculated, set it, otherwise rely on previous logic (N/A or ---)
    if (expVarPct !== null && isFinite(expVarPct)) {
        if (DOM.exp_var_pct) setText('exp_var_pct', expVarPct, 2, ' %');
    }


    // Display errors and warnings
    if (DOM.errorDisplay) {
        let message = '';
        if (errors.length > 0) {
             message += '<p class="error-message">CLIENT CALC ERROR:<br>' + errors.join('<br>') + '</p>';
        }
        // Display warnings, perhaps with a different class or styling
         if (warnings.length > 0) {
             message += '<p class="warning-message" style="color: #FFD700;">WARNING:<br>' + warnings.join('<br>') + '</p>'; // Using gold color for warnings
         }
        DOM.errorDisplay.innerHTML = message;
    }


    // Add result to staging area ONLY IF there are NO critical calculation errors
    // A "full open" warning should NOT prevent adding to staging
    const hasMeasurementData = (showS1 && (s1_o_us != null && s1_o_us > 0)) ||
                               (showS2 && (s2_o_us != null && s2_o_us > 0)) ||
                               (showS3 && (s3_o_us != null && s3_o_us > 0));

    if (typeof addResultToStagingArea === 'function' && hasMeasurementData && errors.length === 0) {
        addResultToStagingArea();
    } else if (errors.length > 0) {
        // Don't add to staging if there were calculation errors, but log if data existed
         if (hasMeasurementData) {
            console.warn("Data received but client calculation errors occurred. Not adding to staging.", errors);
            // Optional: Log the raw data with errors somewhere else if needed
         } else {
             // This case should mostly be caught earlier by hasMeasurementData check,
             // but keep for robustness if errors were pushed without data
             console.warn("Data packet received but contained no valid timestamps or had device errors.", rawData);
         }
    } else if (warnings.length > 0) {
         // Data had warnings but no errors, and had measurement data
         if (hasMeasurementData) {
              console.log("Data received with warnings, added to staging.", warnings);
               addResultToStagingArea(); // ADD TO STAGING EVEN WITH WARNINGS
         } else {
              console.warn("Data packet received with warnings but no valid timestamps.", rawData, warnings);
         }
    } else if (hasMeasurementData) {
         // Data had no errors or warnings, and had measurement data - add to staging
         console.log("Data received with no errors or warnings, added to staging.");
          addResultToStagingArea(); // ADD TO STAGING if data is valid and no errors/warnings
    } else {
         // Data packet received but contained no valid timestamps (e.g., all 0s)
         console.warn("Data packet received but contained no valid timestamps or had device errors.", rawData);
    }
}

function updateEsp32Status(isConnected, message, lastSeenTimestamp) {
     if (!DOM.esp32ConnectionStatus || !DOM.lastUpdate) { console.error("ESP32 status elements not found."); return; }
    DOM.esp32ConnectionStatus.textContent = message;
    DOM.esp32ConnectionStatus.className = 'data-value ' + (isConnected ? 'esp32-connected' : 'esp32-disconnected');
    if (lastSeenTimestamp) {
        DOM.lastUpdate.textContent = new Date(lastSeenTimestamp).toLocaleTimeString();
    } else {
        DOM.lastUpdate.textContent = 'N/A';
    }
}

function updateEspModeDisplay(modeStringFromServer) {
     if (!DOM.sensorModeSelector) { console.error("Mode selector not found for display update."); return; }
    const mode = modeStringFromServer ? String(modeStringFromServer).toUpperCase() : "UNKNOWN";
    let matchedOption = null;
    for (let i = 0; i < DOM.sensorModeSelector.options.length; i++) {
        const option = DOM.sensorModeSelector.options[i];
        if (option.text.toUpperCase().startsWith(mode) || option.value === mode) {
            matchedOption = option;
            break;
        }
    }
    if (matchedOption && matchedOption.selected !== true) {
        matchedOption.selected = true;
        // Only update system status if the mode actually changed from what's currently selected
         if (typeof updateSystemStatus === 'function' && DOM.sensorModeSelector.options[DOM.sensorModeSelector.selectedIndex]?.text.toUpperCase() !== matchedOption.text.toUpperCase()) {
             updateSystemStatus(`Device mode is: ${matchedOption.text}`);
         }
         console.log(`Device mode is: ${matchedOption.text}`); // Always log mode change
    } else if (!matchedOption) {
        if (typeof updateSystemStatus === 'function') updateSystemStatus(`Device reported unknown mode: ${modeStringFromServer || 'N/A'}`);
         console.warn(`Device reported unknown mode: ${modeStringFromServer || 'N/A'}`);
    }
}