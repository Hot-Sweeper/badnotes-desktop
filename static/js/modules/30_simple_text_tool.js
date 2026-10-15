// ============== Simple Text Tool ==============
// Click to place a standard text field

const SimpleTextTool = (function() {
    'use strict';

    let isActiveState = false;

    function activate() {
        isActiveState = true;
        showToast('Click where you want to type', 'info');
        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer) {
            canvasContainer.style.cursor = 'text';
        }
    }

    function deactivate() {
        isActiveState = false;
        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer) {
            canvasContainer.style.cursor = '';
        }
    }

    function isActive() {
        return isActiveState;
    }

    return {
        activate,
        deactivate,
        isActive
    };
})();

window.SimpleTextTool = SimpleTextTool;
