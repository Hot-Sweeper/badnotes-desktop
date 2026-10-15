/**
 * TemplateManager - Page template management
 * Draws template patterns on canvas background
 */
class TemplateManager {
    /**
     * Get theme-aware background color
     */
    static getThemeBackground() {
        // Access global settings if available
        const currentTheme = (typeof settings !== 'undefined' && settings.theme) ||
                            document.documentElement.getAttribute('data-theme') || 'dark';

        if (currentTheme === 'oled') {
            return '#000000';
        } else if (currentTheme === 'light') {
            return '#ffffff';
        } else {
            return '#1a1a1a';
        }
    }

    /**
     * Available templates
     */
    static templates = {
        blank: {
            name: 'Blank',
            draw: (ctx, width, height, options = {}) => {
                // Just fill with background color
                ctx.fillStyle = options.backgroundColor || TemplateManager.getThemeBackground();
                ctx.fillRect(0, 0, width, height);
            },
        },

        lined: {
            name: 'Lined',
            draw: (ctx, width, height, options = {}) => {
                const lineSpacing = options.lineSpacing || 32;
                const lineColor = options.lineColor || 'rgba(255, 255, 255, 0.08)';
                const marginColor = options.marginColor || 'rgba(231, 76, 60, 0.3)';
                const marginX = options.marginX || 80;
                const startY = options.startY || 80;

                // Background
                ctx.fillStyle = options.backgroundColor || TemplateManager.getThemeBackground();
                ctx.fillRect(0, 0, width, height);

                // Horizontal lines
                ctx.strokeStyle = lineColor;
                ctx.lineWidth = 1;

                for (let y = startY; y < height; y += lineSpacing) {
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(width, y);
                    ctx.stroke();
                }

                // Margin line
                if (options.showMargin !== false) {
                    ctx.strokeStyle = marginColor;
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(marginX, 0);
                    ctx.lineTo(marginX, height);
                    ctx.stroke();
                }
            },
        },

        grid: {
            name: 'Grid',
            draw: (ctx, width, height, options = {}) => {
                const gridSize = options.gridSize || 24;
                const lineColor = options.lineColor || 'rgba(255, 255, 255, 0.08)';
                const majorLineColor = options.majorLineColor || 'rgba(255, 255, 255, 0.15)';
                const majorInterval = options.majorInterval || 5;

                // Background
                ctx.fillStyle = options.backgroundColor || TemplateManager.getThemeBackground();
                ctx.fillRect(0, 0, width, height);

                // Grid lines
                for (let x = 0; x <= width; x += gridSize) {
                    const isMajor = (x / gridSize) % majorInterval === 0;
                    ctx.strokeStyle = isMajor ? majorLineColor : lineColor;
                    ctx.lineWidth = isMajor ? 1 : 0.5;

                    ctx.beginPath();
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, height);
                    ctx.stroke();
                }

                for (let y = 0; y <= height; y += gridSize) {
                    const isMajor = (y / gridSize) % majorInterval === 0;
                    ctx.strokeStyle = isMajor ? majorLineColor : lineColor;
                    ctx.lineWidth = isMajor ? 1 : 0.5;

                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(width, y);
                    ctx.stroke();
                }
            },
        },

        dotted: {
            name: 'Dotted',
            draw: (ctx, width, height, options = {}) => {
                const dotSpacing = options.dotSpacing || 24;
                const dotSize = options.dotSize || 2;
                const dotColor = options.dotColor || 'rgba(255, 255, 255, 0.2)';

                // Background
                ctx.fillStyle = options.backgroundColor || TemplateManager.getThemeBackground();
                ctx.fillRect(0, 0, width, height);

                // Dots
                ctx.fillStyle = dotColor;

                for (let x = dotSpacing; x < width; x += dotSpacing) {
                    for (let y = dotSpacing; y < height; y += dotSpacing) {
                        ctx.beginPath();
                        ctx.arc(x, y, dotSize, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            },
        },

        cornell: {
            name: 'Cornell Notes',
            draw: (ctx, width, height, options = {}) => {
                const lineSpacing = options.lineSpacing || 28;
                const lineColor = options.lineColor || 'rgba(255, 255, 255, 0.08)';
                const dividerColor = options.dividerColor || 'rgba(108, 92, 231, 0.5)';
                const cueColumnWidth = options.cueColumnWidth || 160;
                const summaryHeight = options.summaryHeight || 120;
                const headerHeight = options.headerHeight || 60;

                // Background
                ctx.fillStyle = options.backgroundColor || TemplateManager.getThemeBackground();
                ctx.fillRect(0, 0, width, height);

                // Horizontal lines in note area
                ctx.strokeStyle = lineColor;
                ctx.lineWidth = 1;

                for (let y = headerHeight; y < height - summaryHeight; y += lineSpacing) {
                    ctx.beginPath();
                    ctx.moveTo(cueColumnWidth, y);
                    ctx.lineTo(width, y);
                    ctx.stroke();
                }

                // Summary section lines
                for (let y = height - summaryHeight + lineSpacing; y < height; y += lineSpacing) {
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(width, y);
                    ctx.stroke();
                }

                // Dividers
                ctx.strokeStyle = dividerColor;
                ctx.lineWidth = 2;

                // Vertical divider (cue column)
                ctx.beginPath();
                ctx.moveTo(cueColumnWidth, headerHeight);
                ctx.lineTo(cueColumnWidth, height - summaryHeight);
                ctx.stroke();

                // Horizontal divider (summary section)
                ctx.beginPath();
                ctx.moveTo(0, height - summaryHeight);
                ctx.lineTo(width, height - summaryHeight);
                ctx.stroke();

                // Header divider
                ctx.beginPath();
                ctx.moveTo(0, headerHeight);
                ctx.lineTo(width, headerHeight);
                ctx.stroke();
            },
        },

        music: {
            name: 'Music Staff',
            draw: (ctx, width, height, options = {}) => {
                const staffSpacing = options.staffSpacing || 12;
                const staffHeight = staffSpacing * 4;
                const staffGap = options.staffGap || 60;
                const lineColor = options.lineColor || 'rgba(255, 255, 255, 0.15)';
                const marginX = options.marginX || 40;
                const startY = options.startY || 80;

                // Background
                ctx.fillStyle = options.backgroundColor || TemplateManager.getThemeBackground();
                ctx.fillRect(0, 0, width, height);

                ctx.strokeStyle = lineColor;
                ctx.lineWidth = 1;

                let y = startY;
                while (y + staffHeight < height) {
                    // Draw 5 lines for each staff
                    for (let i = 0; i < 5; i++) {
                        ctx.beginPath();
                        ctx.moveTo(marginX, y + i * staffSpacing);
                        ctx.lineTo(width - marginX, y + i * staffSpacing);
                        ctx.stroke();
                    }

                    y += staffHeight + staffGap;
                }
            },
        },

        isometric: {
            name: 'Isometric',
            draw: (ctx, width, height, options = {}) => {
                const gridSize = options.gridSize || 24;
                const lineColor = options.lineColor || 'rgba(255, 255, 255, 0.1)';

                // Background
                ctx.fillStyle = options.backgroundColor || TemplateManager.getThemeBackground();
                ctx.fillRect(0, 0, width, height);

                ctx.strokeStyle = lineColor;
                ctx.lineWidth = 0.5;

                const angle = Math.PI / 6; // 30 degrees
                const stepX = gridSize * Math.cos(angle);
                const stepY = gridSize * Math.sin(angle);

                // Lines going up-right
                for (let x = -height; x < width + height; x += gridSize) {
                    ctx.beginPath();
                    ctx.moveTo(x, height);
                    ctx.lineTo(x + height / Math.tan(angle), 0);
                    ctx.stroke();
                }

                // Lines going up-left
                for (let x = -height; x < width + height; x += gridSize) {
                    ctx.beginPath();
                    ctx.moveTo(x, height);
                    ctx.lineTo(x - height / Math.tan(angle), 0);
                    ctx.stroke();
                }

                // Horizontal lines
                for (let y = 0; y < height; y += gridSize * Math.sin(angle) * 2) {
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(width, y);
                    ctx.stroke();
                }
            },
        },
    };

    /**
     * Draw template on canvas
     */
    static draw(ctx, templateName, width, height, options = {}) {
        const template = TemplateManager.templates[templateName];

        if (template) {
            template.draw(ctx, width, height, options);
        } else {
            // Default to blank
            TemplateManager.templates.blank.draw(ctx, width, height, options);
        }
    }

    /**
     * Get all template names
     */
    static getTemplateNames() {
        return Object.keys(TemplateManager.templates);
    }

    /**
     * Get template info
     */
    static getTemplateInfo(templateName) {
        const template = TemplateManager.templates[templateName];
        return template ? { name: template.name } : null;
    }

    /**
     * Create thumbnail for template
     */
    static createThumbnail(templateName, width = 60, height = 80) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');

        // Scale down the template
        ctx.scale(width / 800, height / 1100);
        TemplateManager.draw(ctx, templateName, 800, 1100);

        return canvas.toDataURL();
    }
}


// Make available globally
window.TemplateManager = TemplateManager;
