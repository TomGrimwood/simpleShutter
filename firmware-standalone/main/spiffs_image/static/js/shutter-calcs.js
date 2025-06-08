// shutter-calcs.js
// Depends on ui-helpers.js for DOM access and setText
function calculateAndDisplayComparison(value1, value2, displayElementId, isDeepDive = false) {
    // Determine the correct prefix for element IDs based on whether it's for the deep dive tab
    const idPrefix = isDeepDive ? 'dd_' : '';
    const fullDisplayElementId = idPrefix + displayElementId;
    const displayElement = DOM[fullDisplayElementId] || document.getElementById(fullDisplayElementId);


    if (!displayElement) { console.warn("Element not found for comparison:", fullDisplayElementId); return; }

    const num1 = parseFloat(String(value1).replace(/[^\d.-]/g, ''));
    const num2 = parseFloat(String(value2).replace(/[^\d.-]/g, ''));
    if (!isFinite(num1) || !isFinite(num2)) { displayElement.innerHTML = '---'; displayElement.className = 'compare-value'; return; }
    let diffPercent = 0;
    if (num1 !== num2) {
        const avgForDiff = (Math.abs(num1) + Math.abs(num2)) / 2;
        if (avgForDiff < 1e-9) diffPercent = (Math.abs(num1) > 1e-9 || Math.abs(num2) > 1e-9) ? 100.0 : 0;
        else diffPercent = Math.abs(num1 - num2) / avgForDiff * 100;
    }
    let symbol = ""; let titleText = ""; const tolerance = 0.5;
    // Use the original displayElementId (without prefix) for logic checks
    const isC1C2 = displayElementId.includes('ct_c1c2');
    let v1Desc = "Val1"; let v2Desc = "Val2";

    // Simplified description logic, can be expanded if needed
    if (isC1C2) { v1Desc = "C1"; v2Desc = "C2"; }
    else if (displayElementId.startsWith('exp_compare_s1s2')) { v1Desc = "S1 Exp"; v2Desc = "S2 Exp"; }
    else if (displayElementId.startsWith('exp_compare_s2s3')) { v1Desc = "S2 Exp"; v2Desc = "S3 Exp"; }
    else if (displayElementId.startsWith('ct_c1_intra_pct_var')) { v1Desc = "C1 S1→S2"; v2Desc = "C1 S2→S3"; }
    else if (displayElementId.startsWith('ct_c2_intra_pct_var')) { v1Desc = "C2 S1→S2"; v2Desc = "C2 S2→S3"; }


    if (diffPercent < tolerance) {
        symbol = "≈"; titleText = `${v1Desc} (${num1.toFixed(3)}) & ${v2Desc} (${num2.toFixed(3)}) are close. Diff: ${diffPercent.toFixed(1)}%`;
    } else if (isC1C2) {
        symbol = (num1 < num2) ? "↓" : "↑";
        titleText = (num1 < num2) ? `${v2Desc} slower by ${diffPercent.toFixed(1)}%` : `${v1Desc} slower by ${diffPercent.toFixed(1)}%`;
    } else {
        symbol = (num1 < num2) ? "<" : ">";
        titleText = (num1 < num2) ? `${v1Desc} faster by ${diffPercent.toFixed(1)}%` : `${v1Desc} slower by ${diffPercent.toFixed(1)}%`;
    }
    displayElement.innerHTML = `<span title="${titleText.replace(/"/g, '&quot;')}">${symbol} (${diffPercent.toFixed(1)}%)</span>`;
    displayElement.className = 'compare-value'; // Reset class
    if (Math.abs(diffPercent) > 5) displayElement.classList.add('compare-value-high-variance');
    else if (diffPercent >= tolerance) displayElement.classList.add('compare-value-low-variance');
}