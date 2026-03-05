const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '../app/src/data/products.js');
const destPath = path.join(__dirname, 'data/products.js');

try {
    let content = fs.readFileSync(srcPath, 'utf8');

    // Transform ES6 export to CommonJS
    // Replace "export const products =" with "module.exports ="
    // And remove any imports if they exist (though products.js seems to be just data)

    content = content.replace('export const products =', 'module.exports =');

    // Check if there are imports to remove
    // The previous view showed no imports at the top, just the export

    fs.writeFileSync(destPath, content);
    console.log('Successfully migrated products.js to server/data/');
} catch (err) {
    console.error('Error migrating data:', err);
}
