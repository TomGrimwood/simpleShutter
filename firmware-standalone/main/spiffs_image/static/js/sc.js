// sc.js

// Helper to calculate and display percentage difference or ratio
function calculateAndDisplayComparison(value1, value2, displayElementId, type = 'percentage_diff') {
    const displayElement = document.getElementById(displayElementId);
    if (!displayElement) {
        console.warn("Element not found for comparison:", displayElementId);
        return;
    }

    if (value1 === null || value2 === null || value1 === undefined || value2 === undefined) {
        displayElement.textContent = '---';
        displayElement.className = 'compare-value'; // Reset class
        return;
    }

    let comparisonResult;
    let resultText;
    let diff;

    if (type === 'percentage_diff') {
        if (value1 === 0 && value2 === 0) {
            diff = 0;
        } else if (value1 === 0) { // Avoid division by zero if value1 is the reference
            diff = Infinity; // Or some other indicator of extreme difference
        } else {
            diff = ((value2 - value1) / value1) * 100;
        }
        comparisonResult = diff;
        resultText = diff.toFixed(1) + '%';
    } else if (type === 'ratio') {
        if (value2 === 0) {
            comparisonResult = Infinity; // Or handle as error/undefined
            resultText = 'Inf';
        } else {
            comparisonResult = value1 / value2;
            resultText = comparisonResult.toFixed(3);
        }
    } else {
        displayElement.textContent = 'Invalid type';
        return;
    }

    displayElement.textContent = resultText;

    // Apply color based on the difference
    if (Math.abs(comparisonResult) > 5 && type === 'percentage_diff') { // Example threshold: 5%
        displayElement.classList.add('compare-value-high-variance');
        displayElement.classList.remove('compare-value-low-variance');
    } else if (type === 'percentage_diff') {
        displayElement.classList.add('compare-value-low-variance');
        displayElement.classList.remove('compare-value-high-variance');
    } else {
        displayElement.className = 'compare-value'; // Reset for ratio or other types
    }
}

// Add other specific calculation utility functions if needed.
// For example, functions to calculate standard deviation, averages, etc.
// might be placed here if they are complex and used in multiple places.
// For now, most direct calculations are in data-updater.js.
