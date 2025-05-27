// shutter-calcs.js (formerly sc.js) - Refined with reference logic

// Helper to calculate and display percentage difference or ratio (from reference, adapted)
function calculateAndDisplayComparison(value1, value2, displayElementId) {
    const displayElement = DOM[displayElementId] || document.getElementById(displayElementId);
    if (!displayElement) {
        console.warn("Element not found for comparison:", displayElementId);
        return;
    }

    // Robust check for valid numeric inputs
    const num1 = parseFloat(String(value1));
    const num2 = parseFloat(String(value2));

    if (!isFinite(num1) || !isFinite(num2)) {
        displayElement.innerHTML = '---'; // Use innerHTML to clear any previous span
        displayElement.className = 'compare-value'; // Reset class
        return;
    }

    let diffPercent = 0;
    if (num1 === num2) {
        diffPercent = 0;
    } else {
        const avgForDiff = (Math.abs(num1) + Math.abs(num2)) / 2;
        if (avgForDiff < 1e-9) { // Average is very close to zero
            diffPercent = (Math.abs(num1) > 1e-9 || Math.abs(num2) > 1e-9) ? 100.0 : 0; // If one is non-zero vs zero, 100% diff
        } else {
            diffPercent = Math.abs(num1 - num2) / avgForDiff * 100;
        }
    }

    let symbol = "";
    let titleText = "";
    const tolerance = 0.5; // Adjusted tolerance: if diffPercent < 0.5%, values are "approximately equal"

    const isC1C2DiffRowCell = displayElementId === 'ct_c1c2_s1s2_compare_pct' ||
                              displayElementId === 'ct_c1c2_s2s3_compare_pct' ||
                              displayElementId === 'ct_c1c2_total_compare_pct';

    let val1_desc = "Val1"; let val2_desc = "Val2";
    if (isC1C2DiffRowCell) {
        val1_desc = "C1"; val2_desc = "C2";
    } else {
        switch (displayElementId) {
            case 'exp_compare_s1s2': val1_desc = "S1 Exp"; val2_desc = "S2 Exp"; break;
            case 'exp_compare_s2s3': val1_desc = "S2 Exp"; val2_desc = "S3 Exp"; break;
            case 'ct_c1_intra_pct_var': val1_desc = "C1 S1→S2"; val2_desc = "C1 S2→S3"; break;
            case 'ct_c2_intra_pct_var': val1_desc = "C2 S1→S2"; val2_desc = "C2 S2→S3"; break;
        }
    }

    if (diffPercent < tolerance) {
        symbol = "≈";
        titleText = `${val1_desc} (${num1.toFixed(3)}ms) and ${val2_desc} (${num2.toFixed(3)}ms) are very close. Diff: ${diffPercent.toFixed(1)}% of avg.`;
        if (num1 === num2) titleText = `${val1_desc} & ${val2_desc} are equal (${num1.toFixed(3)}ms).`;
    } else if (isC1C2DiffRowCell) { // C1 vs C2 times
        if (num1 < num2) { // C2 (num2) is slower/larger
            symbol = "↓"; titleText = `${val2_desc} (${num2.toFixed(3)}ms) is ${diffPercent.toFixed(1)}% slower than ${val1_desc} (${num1.toFixed(3)}ms).`;
        } else { // C1 (num1) is slower/larger
            symbol = "↑"; titleText = `${val1_desc} (${num1.toFixed(3)}ms) is ${diffPercent.toFixed(1)}% slower than ${val2_desc} (${num2.toFixed(3)}ms).`;
        }
    } else { // General comparisons (e.g., exposure, intra-curtain segments)
        if (num1 < num2) {
            symbol = "<"; titleText = `${val1_desc} (${num1.toFixed(3)}ms) is ${diffPercent.toFixed(1)}% faster than ${val2_desc} (${num2.toFixed(3)}ms).`;
        } else { // num1 > num2
            symbol = ">"; titleText = `${val1_desc} (${num1.toFixed(3)}ms) is ${diffPercent.toFixed(1)}% slower than ${val2_desc} (${num2.toFixed(3)}ms).`;
        }
    }

    displayElement.innerHTML = `<span title="${titleText.replace(/"/g, '"')}">${symbol} (${diffPercent.toFixed(1)}%)</span>`;
    displayElement.className = 'compare-value'; // Reset base class

    // Apply variance styling (from original logic)
    if (Math.abs(diffPercent) > 5) { // Example threshold: 5%
        displayElement.classList.add('compare-value-high-variance');
    } else if (diffPercent >= tolerance) { // Only add low-variance if not 'approximately equal' but still under 5%
        displayElement.classList.add('compare-value-low-variance');
    }
}