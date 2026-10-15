// ============== Handwritten Text Tool ==============
// Simple activation tool - click to create text fields

const HandwrittenTextTool = (function() {
    'use strict';

    let isActiveState = false;

    /**
     * Activate the tool - user will click to place text
     */
    function activate() {
        isActiveState = true;
        showToast('Click where you want to type', 'info');

        // Change cursor
        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer) {
            canvasContainer.style.cursor = 'text';
        }
    }

    /**
     * Deactivate the tool
     */
    function deactivate() {
        isActiveState = false;
        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer) {
            canvasContainer.style.cursor = '';
        }
    }

    /**
     * Check if tool is active
     */
    function isActive() {
        return isActiveState;
    }

    // Public API
    return {
        activate,
        deactivate,
        isActive
    };
})();

window.HandwrittenTextTool = HandwrittenTextTool;
