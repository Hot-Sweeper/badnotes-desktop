/**
 * ExportHandler - Handle various export formats
 */
class ExportHandler {
    /**
     * Export notebook to various formats
     */
    static async export(notebook, pages, format, options = {}) {
        switch (format) {

            case 'png':
                return ExportHandler.exportToPNG(notebook, pages, options);
            case 'svg':
                return ExportHandler.exportToSVG(notebook, pages, options);
            case 'json':
                return ExportHandler.exportToJSON(notebook, pages, options);
            default:
                throw new Error(`Unknown export format: ${format}`);
        }
    }

    /**
     * Export pages as PNG images
     */
    static async exportToPNG(notebook, pages, options = {}) {
        try {
            LoadingOverlay.show('Exporting images...');

            const quality = options.quality || 2; // Scale factor

            for (let i = 0; i < pages.length; i++) {
                LoadingOverlay.setMessage(`Exporting page ${i + 1} of ${pages.length}...`);

                const page = pages[i];
                const canvas = document.createElement('canvas');
                canvas.width = (page.width || 800) * quality;
                canvas.height = (page.height || 1100) * quality;

                const ctx = canvas.getContext('2d');
                ctx.scale(quality, quality);

                // Draw background
                ctx.fillStyle = page.backgroundColor || '#ffffff';
                ctx.fillRect(0, 0, page.width || 800, page.height || 1100);

                // Render elements
                await ExportHandler.renderPageElements(ctx, page);

                // Download
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                const url = URL.createObjectURL(blob);

                const link = document.createElement('a');
                link.href = url;
                link.download = `${notebook.name || 'page'}_${i + 1}.png`;
                link.click();

                URL.revokeObjectURL(url);

                // Small delay between downloads
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            LoadingOverlay.hide();
            Toast.success('Images exported successfully');
        } catch (error) {
            console.error('PNG export failed:', error);
            LoadingOverlay.hide();
            Toast.error('Failed to export images');
            throw error;
        }
    }

    /**
     * Export pages as SVG
     */
    static async exportToSVG(notebook, pages, options = {}) {
        try {
            LoadingOverlay.show('Exporting SVG...');

            for (let i = 0; i < pages.length; i++) {
                LoadingOverlay.setMessage(`Exporting page ${i + 1} of ${pages.length}...`);

                const page = pages[i];
                const svg = ExportHandler.pageToSVG(page);

                // Download
                const blob = new Blob([svg], { type: 'image/svg+xml' });
                const url = URL.createObjectURL(blob);

                const link = document.createElement('a');
                link.href = url;
                link.download = `${notebook.name || 'page'}_${i + 1}.svg`;
                link.click();

                URL.revokeObjectURL(url);

                await new Promise(resolve => setTimeout(resolve, 100));
            }

            LoadingOverlay.hide();
            Toast.success('SVG files exported successfully');
        } catch (error) {
            console.error('SVG export failed:', error);
            LoadingOverlay.hide();
            Toast.error('Failed to export SVG');
            throw error;
        }
    }

    /**
     * Convert page to SVG
     */
    static pageToSVG(page) {
        const width = page.width || 800;
        const height = page.height || 1100;

        let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="${page.backgroundColor || '#ffffff'}"/>
`;

        // Add strokes
        if (page.strokes) {
            for (const stroke of page.strokes) {
                svg += ExportHandler.strokeToSVGPath(stroke);
            }
        }

        // Add shapes
        if (page.shapes) {
            for (const shape of page.shapes) {
                svg += ExportHandler.shapeToSVG(shape);
            }
        }

        // Add text
        if (page.textElements) {
            for (const text of page.textElements) {
                svg += ExportHandler.textToSVG(text);
            }
        }

        svg += '</svg>';
        return svg;
    }

    /**
     * Convert stroke to SVG path
     */
    static strokeToSVGPath(stroke) {
        if (!stroke.points || stroke.points.length < 2) return '';

        let d = `M ${stroke.points[0].x} ${stroke.points[0].y}`;

        for (let i = 1; i < stroke.points.length; i++) {
            d += ` L ${stroke.points[i].x} ${stroke.points[i].y}`;
        }

        return `<path d="${d}" fill="none" stroke="${stroke.color || '#000000'}" stroke-width="${stroke.size || 2}" stroke-linecap="round" stroke-linejoin="round" opacity="${stroke.opacity || 1}"/>\n`;
    }

    /**
     * Convert shape to SVG
     */
    static shapeToSVG(shape) {
        const style = `fill="${shape.fill ? (shape.fillColor || 'none') : 'none'}" stroke="${shape.color || '#000000'}" stroke-width="${shape.size || 2}" opacity="${shape.opacity || 1}"`;

        switch (shape.shapeType) {
            case 'rectangle':
                return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" ${style}/>\n`;
            case 'ellipse':
                return `<ellipse cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}" ${style}/>\n`;
            case 'line':
                return `<line x1="${shape.points[0].x}" y1="${shape.points[0].y}" x2="${shape.points[1].x}" y2="${shape.points[1].y}" ${style}/>\n`;
            default:
                return '';
        }
    }

    /**
     * Convert text to SVG
     */
    static textToSVG(text) {
        const escaped = text.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<text x="${text.x}" y="${text.y + text.fontSize}" fill="${text.color || '#000000'}" font-size="${text.fontSize || 16}px" font-family="${text.fontFamily || 'Arial'}">${escaped}</text>\n`;
    }

    /**
     * Export notebook as JSON backup
     */
    static async exportToJSON(notebook, pages, options = {}) {
        try {
            LoadingOverlay.show('Creating backup...');

            const backup = {
                version: '1.0',
                exportedAt: new Date().toISOString(),
                notebook: {
                    ...notebook,
                    pages: pages,
                },
            };

            const json = JSON.stringify(backup, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = `${notebook.name || 'notebook'}_backup.json`;
            link.click();

            URL.revokeObjectURL(url);
            LoadingOverlay.hide();

            Toast.success('Backup exported successfully');
        } catch (error) {
            console.error('JSON export failed:', error);
            LoadingOverlay.hide();
            Toast.error('Failed to export backup');
            throw error;
        }
    }

    /**
     * Import JSON backup
     */
    static async importJSON(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const backup = JSON.parse(e.target.result);

                    if (!backup.notebook) {
                        throw new Error('Invalid backup file');
                    }

                    resolve(backup.notebook);
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    /**
     * Render all page elements to context
     */
    static async renderPageElements(ctx, page) {
        // Render strokes
        if (page.strokes) {
            for (const stroke of page.strokes) {
                StrokeRenderer.render(ctx, stroke);
            }
        }

        // Render shapes
        if (page.shapes) {
            for (const shape of page.shapes) {
                ShapeRenderer.render(ctx, shape);
            }
        }

        // Render text
        if (page.textElements) {
            for (const text of page.textElements) {
                TextRenderer.render(ctx, text);
            }
        }

        // Render images
        if (page.images) {
            for (const img of page.images) {
                await ImageRenderer.render(ctx, img);
            }
        }
    }
}


window.ExportHandler = ExportHandler;
