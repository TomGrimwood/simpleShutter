// config-panel.js - Refined

let internalTimeScalingFactor = 1.0; // Keep factor internal to this module

function _calculateAndSetScalingFactor() {
    const actualDist = parseFloat(DOM.totalSensorDistanceConfigInput.value);
    const calibDist = parseFloat(DOM.calibrationTargetDistanceConfigInput.value);

    if (!isNaN(actualDist) && actualDist > 0 && !isNaN(calibDist) && calibDist >= 0) {
        internalTimeScalingFactor = calibDist / actualDist;
        DOM.timeScalingFactorDisplay.textContent = internalTimeScalingFactor.toFixed(4);
        DOM.timeScalingFactorDisplay.classList.remove("error-message"); // From reference style
    } else {
        internalTimeScalingFactor = 1.0; // Default to 1.0 if inputs are invalid
        DOM.timeScalingFactorDisplay.textContent = "Error (invalid input)";
        DOM.timeScalingFactorDisplay.classList.add("error-message"); // From reference style
    }
    return internalTimeScalingFactor;
}

function updateScalingFactorAndRedisplay() {
    _calculateAndSetScalingFactor();
    // Call the global triggerDisplayUpdate from main.js
    if (typeof triggerDisplayUpdate === 'function') {
        triggerDisplayUpdate();
    } else {
        console.error("triggerDisplayUpdate function not found. Ensure main.js is loaded and function is global.");
    }
}

function getCurrentTimeScalingFactor() {
    // Ensure the factor is up-to-date if called externally, though typically it's driven by input events.
    // _calculateAndSetScalingFactor(); // This might be redundant if inputs always trigger update.
    // For safety, let's rely on the internal variable being up-to-date via event listeners.
    return internalTimeScalingFactor;
}

function initializeConfigPanelInteraction() {
    _calculateAndSetScalingFactor(); // Initial calculation

    DOM.totalSensorDistanceConfigInput.addEventListener('input', updateScalingFactorAndRedisplay);
    DOM.calibrationTargetDistanceConfigInput.addEventListener('input', updateScalingFactorAndRedisplay);

    DOM.toggleConfigButton.addEventListener('click', () => {
        const isCurrentlyCollapsed = DOM.configPanel.classList.contains('collapsed');
        DOM.configPanel.classList.toggle('collapsed', !isCurrentlyCollapsed);

        if (!isCurrentlyCollapsed) { // Is going to be collapsed
            DOM.toggleConfigButton.innerHTML = '»'; // Reference style
            DOM.toggleConfigButton.title = "Expand Configuration Panel";
        } else { // Is going to be expanded
            DOM.toggleConfigButton.innerHTML = '«'; // Reference style
            DOM.toggleConfigButton.title = "Collapse Configuration Panel";
        }
        localStorage.setItem('configPanelCollapsed', String(!isCurrentlyCollapsed));
    });

    // Restore state from localStorage
    if (localStorage.getItem('configPanelCollapsed') === 'true') {
        DOM.configPanel.classList.add('collapsed');
        DOM.toggleConfigButton.innerHTML = '»';
        DOM.toggleConfigButton.title = "Expand Configuration Panel";
    } else {
        DOM.configPanel.classList.remove('collapsed');
        DOM.toggleConfigButton.innerHTML = '«';
        DOM.toggleConfigButton.title = "Collapse Configuration Panel";
    }
}