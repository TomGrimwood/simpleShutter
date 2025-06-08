let internalTimeScalingFactor = 1.0;

function _calculateAndSetScalingFactor() {
    const actualDist = parseFloat(DOM.totalSensorDistanceConfigInput.value);
    const calibDist = parseFloat(DOM.calibrationTargetDistanceConfigInput.value);

    // Ensure input elements exist before accessing their values
    if (!DOM.totalSensorDistanceConfigInput || !DOM.calibrationTargetDistanceConfigInput) {
        console.error("Config inputs not found.");
        internalTimeScalingFactor = 1.0;
        if (DOM.timeScalingFactorDisplay) {
            DOM.timeScalingFactorDisplay.textContent = "Error (inputs missing)";
            DOM.timeScalingFactorDisplay.classList.add("error-message");
        }
        return internalTimeScalingFactor;
    }


    if (!isNaN(actualDist) && actualDist > 0 && !isNaN(calibDist) && calibDist >= 0) {
        internalTimeScalingFactor = calibDist / actualDist;
        if (DOM.timeScalingFactorDisplay) {
             DOM.timeScalingFactorDisplay.textContent = internalTimeScalingFactor.toFixed(4);
             DOM.timeScalingFactorDisplay.classList.remove("error-message");
        }
    } else {
        internalTimeScalingFactor = 1.0;
        if (DOM.timeScalingFactorDisplay) {
            DOM.timeScalingFactorDisplay.textContent = "Error (invalid input)";
            DOM.timeScalingFactorDisplay.classList.add("error-message");
        }
    }
    return internalTimeScalingFactor;
}

function updateScalingFactorAndRedisplay() {
    _calculateAndSetScalingFactor();
    // Call a global function or trigger a custom event if needed
    // For now, assuming triggerDisplayUpdate is in the global scope as in the original code
    if (typeof window.triggerDisplayUpdate === 'function') window.triggerDisplayUpdate();
    else console.error("triggerDisplayUpdate function not found (config-panel.js).");
}

function getCurrentTimeScalingFactor() { return internalTimeScalingFactor; }

function initializeConfigPanelInteraction() {
    // Ensure DOM elements exist before adding listeners
    if (!DOM.totalSensorDistanceConfigInput || !DOM.calibrationTargetDistanceConfigInput || !DOM.toggleConfigButton || !DOM.configPanel) {
        console.error("Failed to initialize config panel interaction: Missing DOM elements.");
        return;
    }

    _calculateAndSetScalingFactor();
    DOM.totalSensorDistanceConfigInput.addEventListener('input', updateScalingFactorAndRedisplay);
    DOM.calibrationTargetDistanceConfigInput.addEventListener('input', updateScalingFactorAndRedisplay);

    DOM.toggleConfigButton.addEventListener('click', () => {
        const isCollapsed = DOM.configPanel.classList.toggle('collapsed');
        DOM.toggleConfigButton.innerHTML = isCollapsed ? '»' : '«';
        DOM.toggleConfigButton.title = isCollapsed ? "Expand Panel" : "Collapse Panel";
        try { localStorage.setItem('configPanelCollapsed', String(isCollapsed)); }
        catch (e) { console.warn("localStorage not available for config panel state:", e); }
    });

    // Restore collapsed state from localStorage
    try {
        if (localStorage.getItem('configPanelCollapsed') === 'true') {
            DOM.configPanel.classList.add('collapsed');
            if (DOM.toggleConfigButton) {
                 DOM.toggleConfigButton.innerHTML = '»';
                 DOM.toggleConfigButton.title = "Expand Panel";
            }
        }
    } catch (e) { console.warn("localStorage not available for config panel state.", e); }
}