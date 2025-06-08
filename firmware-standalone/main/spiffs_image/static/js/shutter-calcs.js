// shutter-calcs.js
// Depends on ui-helpers.js for DOM access and setText

// Helper function to calculate the percentage difference between two numbers
// This function is used internally by calculateAndDisplayComparison
function calculateComparisonPercentage(value1, value2) {
    // Ensure getText helper is available
    if (typeof getText !== 'function') {
        console.error("calculateComparisonPercentage failed: getText helper not available.");
        return NaN;
    }

    // Use getText helper to robustly parse numeric values
    const num1 = parseFloat(getText(null, value1)); // Pass null for DOM ID, use value directly
    const num2 = parseFloat(getText(null, value2)); // Pass null for DOM ID, use value directly


    if (!isFinite(num1) || !isFinite(num2)) {
        return NaN; // Return NaN if either value is invalid
    }

    // Handle cases where both are effectively zero
    if (Math.abs(num1) < 1e-9 && Math.abs(num2) < 1e-9) {
        return 0; // If both are very close to zero, consider the difference 0%
    }
     // Handle case where one is zero and the other is not - potentially infinite percentage difference, or 100% relative to the non-zero value
     // Returning 100% is often reasonable for a simple UI display in this context if comparing non-zero vs zero.
     if (Math.abs(num1) < 1e-9 || Math.abs(num2) < 1e-9) {
          return 100.0;
     }


    const avgForDiff = (Math.abs(num1) + Math.abs(num2)) / 2;
     if (avgForDiff < 1e-9) { // Avoid division by zero if both are near zero after previous checks
          return 0;
     }

    return Math.abs(num1 - num2) / avgForDiff * 100;
}
// No longer exporting calculateComparisonPercentage publicly


// Calculates and displays the percentage difference between two values for the main table or deep dive table.
// value1, value2: The numeric values to compare (or strings like "1.234 ms" that can be parsed by getText).
// displayElementId: The ID of the DOM element where the comparison result will be displayed (e.g., 'exp_compare_s1s2', 'dd_exp_compare_s1s2').
function calculateAndDisplayComparison(value1, value2, displayElementId) {
    // Use DOM helper if available, otherwise get element directly
    const displayElement = DOM[displayElementId] || document.getElementById(displayElementId);

    if (!displayElement) { console.warn("Element not found for comparison:", displayElementId); return; }

    const diffPercent = calculateComparisonPercentage(value1, value2);

    if (isNaN(diffPercent)) {
         displayElement.innerHTML = '---';
         displayElement.className = 'compare-value'; // Reset class
         return;
    }

    // Use getText helper to get the numeric values for tooltip, handling potential '---'
    const num1 = parseFloat(getText(null, value1));
    const num2 = parseFloat(getText(null, value2));

    let symbol = ""; let titleText = ""; const tolerance = 0.5;

    // Determine description based on element ID
    // This logic is used for the tooltip text
    let v1Desc = "Val1"; let v2Desc = "Val2";
    const id = displayElementId;
    if (id.includes('exp_compare_s1s2')) { v1Desc = "S1 Exp"; v2Desc = "S2 Exp"; }
    else if (id.includes('exp_compare_s2s3')) { v1Desc = "S2 Exp"; v2Desc = "S3 Exp"; }
    else if (id.includes('ct_c1_intra_pct_var')) { v1Desc = "C1 S1→S2"; v2Desc = "C1 S2→S3"; }
    else if (id.includes('ct_c2_intra_pct_var')) { v1Desc = "C2 S1→S2"; v2Desc = "C2 S2→S3"; }
    else if (id.includes('ct_c1c2_s1s2_compare_pct')) { v1Desc = "C1 S1→S2"; v2Desc = "C2 S1→S2"; }
    else if (id.includes('ct_c1c2_s2s3_compare_pct')) { v1Desc = "C1 S2→S3"; v2Desc = "C2 S2→S3"; }
    else if (id.includes('ct_c1c2_total_compare_pct')) { v1Desc = "C1 Total"; v2Desc = "C2 Total"; }


     if (diffPercent < tolerance) {
         symbol = "≈";
          // Check if both numbers are valid before formatting
          if (isFinite(num1) && isFinite(num2)) {
               titleText = `${v1Desc} (${num1.toFixed(3)}) & ${v2Desc} (${num2.toFixed(3)}) are close. Diff: ${diffPercent.toFixed(1)}%`;
          } else {
              titleText = `Values are close. Diff: ${diffPercent.toFixed(1)}%`; // Generic if numbers aren't valid
          }
     } else {
          // Determine directionality symbol based on the comparison type
          if (id.includes('ct_c1c2')) {
             // For C1 vs C2 comparisons, show which curtain/value is slower/larger
              symbol = (num1 < num2) ? "↓" : "↑"; // If num1 < num2, C2 is larger/slower (relative to C1's smaller value)
              // Check if numbers are valid before formatting
               if (isFinite(num1) && isFinite(num2)) {
                 titleText = (num1 < num2) ? `${v2Desc} slower/larger by ${diffPercent.toFixed(1)}% (C1: ${num1.toFixed(3)}, C2: ${num2.toFixed(3)})`
                                          : `${v1Desc} slower/larger by ${diffPercent.toFixed(1)}% (C1: ${num1.toFixed(3)}, C2: ${num2.toFixed(3)})`;
               } else {
                   titleText = (num1 < num2) ? `${v2Desc} slower/larger by ${diffPercent.toFixed(1)}%`
                                            : `${v1Desc} slower/larger by ${diffPercent.toFixed(1)}%`;
               }

         } else {
              // For intra-curtain (segment-to-segment) or inter-sensor (exposure) comparisons, show relative speed/size
              symbol = (num1 < num2) ? "<" : ">"; // If num1 < num2, Val1 is smaller/faster than Val2
               // Check if numbers are valid before formatting
               if (isFinite(num1) && isFinite(num2)) {
                  titleText = (num1 < num2) ? `${v1Desc} faster/smaller by ${diffPercent.toFixed(1)}% (${num1.toFixed(3)} vs ${num2.toFixed(3)})`
                                           : `${v1Desc} slower/larger by ${diffPercent.toFixed(1)}% (${num1.toFixed(3)} vs ${num2.toFixed(3)})`;
               } else {
                   titleText = (num1 < num2) ? `${v1Desc} faster/smaller by ${diffPercent.toFixed(1)}%`
                                            : `${v1Desc} slower/larger by ${diffPercent.toFixed(1)}%`;
               }
         }
     }


    displayElement.innerHTML = `<span title="${titleText.replace(/"/g, '"')}">${symbol} (${diffPercent.toFixed(1)}%)</span>`;
    displayElement.className = 'compare-value'; // Reset class
    if (Math.abs(diffPercent) > 5) displayElement.classList.add('compare-value-high-variance');
    else if (diffPercent >= tolerance) displayElement.classList.add('compare-value-low-variance');
}
// Exporting calculateAndDisplayComparison
window.calculateAndDisplayComparison = calculateAndDisplayComparison;

// calculateAndDisplayComparisonValue is no longer needed for the deep dive table
// and will be removed.