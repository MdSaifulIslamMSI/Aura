const fs = require('fs');
const path = require('path');

const productsFilePath = path.join(__dirname, 'data', 'products.js');
let fileContent = fs.readFileSync(productsFilePath, 'utf8');

// Map categories to new images
const imageMap = {
    'Mobiles': '/assets/nano_banana_hero.png', // Default for mobiles if not specific
    'Laptops': '/assets/nano_laptop.png',
    'Electronics': '/assets/nano_headphones.png', // Default for electronics
    'Headphones': '/assets/nano_headphones.png', // Subcategory specific
    'Smartwatches': '/assets/nano_watch.png',
    "Men's Fashion": '/assets/nano_fashion_men.png',
    "Women's Fashion": '/assets/nano_fashion_women.png',
    'Gaming': '/assets/nano_gaming.png',
    'Gaming & Accessories': '/assets/nano_gaming.png'
};

// Function to update images based on category in the file content
function updateImages() {
    // pattern to find objects in the array. This is a simple approximation.
    // We assume standard formatting: { ... category: "X", ... image: "Y", ... }

    // Split into lines to process line by line or block by block
    // actually, let's use a smarter regex replacer

    // We will look for blocks. Since the file is well formatted, we can iterate.

    let updatedContent = fileContent;

    // Define categories to look for
    const categories = Object.keys(imageMap);

    // Naive approach: Find all image lines and check context? 
    // Better: Regex replace for specific categories.

    // Strategy: 
    // 1. Find a category line: `category: "Laptops",`
    // 2. Look ahead for the `image: "...",` line within reasonable distance and replace it.

    // Replace Laptops
    updatedContent = updatedContent.replace(
        /(category:\s*"Laptops",[\s\S]*?image:\s*")[^"]*(")/g,
        `$1${imageMap['Laptops']}$2`
    );

    // Replace Men's Fashion
    updatedContent = updatedContent.replace(
        /(category:\s*"Men's Fashion",[\s\S]*?image:\s*")[^"]*(")/g,
        `$1${imageMap["Men's Fashion"]}$2`
    );

    // Replace Women's Fashion
    updatedContent = updatedContent.replace(
        /(category:\s*"Women's Fashion",[\s\S]*?image:\s*")[^"]*(")/g,
        `$1${imageMap["Women's Fashion"]}$2`
    );

    // Replace Gaming
    updatedContent = updatedContent.replace(
        /(category:\s*"Gaming & Accessories",[\s\S]*?image:\s*")[^"]*(")/g,
        `$1${imageMap['Gaming']}$2`
    );

    // Electronics is tricky because of subcategories (Headphones, Smartwatches)
    // We should target subCategories first!

    // SubCategory: Headphones
    updatedContent = updatedContent.replace(
        /(subCategory:\s*"Headphones",[\s\S]*?image:\s*")[^"]*(")/g,
        `$1${imageMap['Headphones']}$2`
    );
    // SubCategory: Smartwatches
    updatedContent = updatedContent.replace(
        /(subCategory:\s*"Smartwatches",[\s\S]*?image:\s*")[^"]*(")/g,
        `$1${imageMap['Smartwatches']}$2`
    );

    // Generic Electronics fallbacks (for things matching Electronics but NOT the above)
    // This regex might be risky if we already replaced subcategories, but if we do this last, 
    // we need to be careful not to overwrite.
    // Actually our regex `[\s\S]*?` matches closest image. 
    // If SubCategory is BEFORE image, it works. 
    // In the file, `category` is usually before `subCategory` and `image` is after `subCategory`.

    // Re-doing strategy:
    // Regex matches `subCategory: "Headphones" ... image: "OLD"` replacing OLD with NEW.
    // If I run SubCategory replacements FIRST, they are done.
    // Then I can run generic Category replacements for the rest?
    // Wait, if I run Category: Electronics replace, it will overwrite Headphones if I'm not careful.
    // Solution: Only replace if the image string starts with "http" (meaning it has not been replaced by local asset yet).

    const isUnsplash = "https://images.unsplash.com";

    // Helper to replace safe
    const replaceIfRemote = (catType, catName, newImg) => {
        // Regex: matches key: "Value", then anything until image: "https...", capture the prefix until url start
        // We use a function replacement to check the current value
        const regex = new RegExp(`(${catType}:\\s*"${catName}",[\\s\\S]*?image:\\s*")([^"]*)(")`, 'g');
        updatedContent = updatedContent.replace(regex, (match, prefix, currentUrl, suffix) => {
            if (currentUrl.startsWith('http')) {
                return `${prefix}${newImg}${suffix}`;
            }
            return match; // Already updated
        });
    };

    // SubCategories (Prioritize these)
    replaceIfRemote('subCategory', 'Headphones', imageMap['Headphones']);
    replaceIfRemote('subCategory', 'Smartwatches', imageMap['Smartwatches']);
    replaceIfRemote('subCategory', 'Gaming Consoles', imageMap['Gaming']);

    // Categories (General)
    replaceIfRemote('category', 'Laptops', imageMap['Laptops']);
    replaceIfRemote('category', "Men's Fashion", imageMap["Men's Fashion"]);
    replaceIfRemote('category', "Women's Fashion", imageMap["Women's Fashion"]);
    replaceIfRemote('category', 'Gaming & Accessories', imageMap['Gaming']);

    // General Electronics fallback
    replaceIfRemote('category', 'Electronics', imageMap['Electronics']);

    fs.writeFileSync(productsFilePath, updatedContent, 'utf8');
    console.log('Successfully updated product images in products.js');
}

updateImages();
