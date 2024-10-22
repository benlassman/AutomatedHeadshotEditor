const Jimp = require('jimp');
const fs = require('fs-extra');
const csvParser = require('csv-parser');

// Function to convert JPG to PNG and return the path
async function convertToPNG(imagePath) {
    const image = await Jimp.read(imagePath);
    const pngPath = imagePath.replace('.jpg', '.png'); // Change the file extension to .png
    await image.writeAsync(pngPath); // Save as PNG
    return pngPath; // Return the new PNG path
}

// Function to create a solid color overlay with a smaller oval cutout
async function createTransparentOverlay(width, height) {
    // Create a new image with a solid white color
    const overlay = new Jimp(width, height, '#ffffff'); // Solid white in hex format

    // Define oval properties
    const ovalX = width / 2;  // X position in the center
    const ovalY = height * 0.4; // Y position higher up in the center (40% from top)
    const ovalWidth = Math.min(width, height) * 0.40; // Width as 45% of the smallest dimension
    const ovalHeight = Math.min(width, height) * 0.5; // Height as 50% of the smallest dimension

    // Draw a transparent oval in the center
    overlay.scan(0, 0, width, height, (x, y, idx) => {
        const dx = x - ovalX;
        const dy = y - ovalY;

        // Check if the pixel is inside the oval
        if ((dx * dx) / (ovalWidth * ovalWidth) + (dy * dy) / (ovalHeight * ovalHeight) <= 1) {
            // Make the pixel transparent
            overlay.bitmap.data[idx + 3] = 0; // Set alpha to 0 (transparent)
        }
    });

    // Create bottom corners effect
    const cornerHeight = height * 0.25; // 25% of the height for bottom corners
    overlay.scan(0, height - cornerHeight, width, height, (x, y, idx) => {
        // Set the bottom 25% to solid white
        overlay.bitmap.data[idx] = 255;   // Red
        overlay.bitmap.data[idx + 1] = 255; // Green
        overlay.bitmap.data[idx + 2] = 255; // Blue
        overlay.bitmap.data[idx + 3] = 255; // Alpha (opaque)
    });

    // Draw a black border around the oval
    overlay.scan(0, 0, width, height, (x, y, idx) => {
        const distanceSquared = ((x - ovalX) ** 2) / (ovalWidth ** 2) + ((y - ovalY) ** 2) / (ovalHeight ** 2);
        const isInsideOval = distanceSquared < 1;
        const isNearBorder = distanceSquared >= 1 && distanceSquared <= 1.05; // Adjust border thickness here

        // Set border color
        if (isNearBorder) {
            overlay.bitmap.data[idx] = 0;     // Red
            overlay.bitmap.data[idx + 1] = 0; // Green
            overlay.bitmap.data[idx + 2] = 0; // Blue
            overlay.bitmap.data[idx + 3] = 255; // Alpha (opaque)
        }
    });

    return overlay;
}

// Function to process a single image
async function processImage(imagePath, outputPath, blueBackgroundPath, firstName, lastName) {
    // Convert the JPG image to PNG first
    const pngImagePath = await convertToPNG(imagePath);
    
    const image = await Jimp.read(pngImagePath);
    const background = await Jimp.read(blueBackgroundPath);

    // Rotate the image 270 degrees to the right
    image.rotate(270);

    // Resize the blue background to match the student image dimensions after rotation
    background.resize(image.bitmap.width, image.bitmap.height);

    // Create a mask to remove the green screen from the original image
    image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, idx) => {
        const red = image.bitmap.data[idx + 0];
        const green = image.bitmap.data[idx + 1];
        const blue = image.bitmap.data[idx + 2];

        // Stricter thresholds for green detection
        const isGreen = (green > 200 && red < 150 && blue < 150);
        const isLightGreen = (green > 180 && red > 120 && blue > 120 && (green - red) > 50 && (green - blue) > 50);
        const isNearGreen = (green > 150 && red < 130 && blue < 130 && (green - red) > 30 && (green - blue) > 30);

        if (isGreen || isLightGreen || isNearGreen) {
            // Set this pixel to be fully transparent
            image.bitmap.data[idx + 3] = 0; // Set alpha to 0 (transparent)
        }
    });



    // Composite the blue background behind the student image
    background.composite(image, 0, 0);

    // Create a solid color overlay with an oval cutout
    const overlay = await createTransparentOverlay(background.bitmap.width, background.bitmap.height);

    // Composite the overlay on top of the existing image
    background.composite(overlay, 0, 0); // Ensure the overlay is on top
    
    // Prepare the name text
    const font = await Jimp.loadFont(Jimp.FONT_SANS_128_BLACK); // Larger font size
    const name = `${firstName} ${lastName}`;

    // Oval parameters
    const ovalX = background.bitmap.width / 2;  // X position of the oval center
    const ovalY = background.bitmap.height * 0.75; // Lowered for better positioning (adjust as needed)
    const ovalWidth = Math.min(background.bitmap.width, background.bitmap.height) * 0.75; // Width of the oval
    const ovalHeight = Math.min(background.bitmap.width, background.bitmap.height) * 0.45; // Height of the oval

    // Angle calculations for the characters
    const angleStep = Math.PI / (name.length); // Reduce spacing between letters to about a quarter
    // const angleStep = Math.PI / (name.length * 2); // Reduce spacing between letters to about a quarter
    const startAngle = Math.PI; // Start angle at 180 degrees for downward arc

    // Write each character in a curved line
    for (let i = 0; i < name.length; i++) {
        const char = name[i];

        // Measure character width and height
        const charWidth = Jimp.measureText(font, char);
        const charHeight = Jimp.measureTextHeight(font, char);

        // Calculate the angle for the character (create an arc)
        const angle = startAngle - (i * (angleStep)); // Adjusted to create downward arc

        // Calculate the position for the character based on the angle
        const currentX = ovalX + (ovalWidth / 2) * Math.cos(angle) - charWidth / 2; // Center the character horizontally
        const currentY = ovalY + (ovalHeight / 2) * Math.sin(angle) - charHeight / 2 - 500; // Adjust height for better arc

        // Create an empty image for the character
        const charImage = new Jimp(charWidth, charHeight, 0x00000000); // Create a transparent image
        charImage.print(font, 0, 0, char); // Print the character onto the empty image

        // Composite the character onto the main image at the current position
        background.composite(charImage, currentX, currentY); // Position the character
    }

    // Save the final image as PNG
    await background.writeAsync(outputPath.replace('.jpg', '.png')); // Ensure output is PNG
}

// Function to process images from a folder based on a CSV file
async function processImagesFromFolder(csvFile, imagesFolder, blueBackground) {
    const students = [];

    // Create the processed-images folder if it doesn't exist
    const outputFolder = 'processed-images';
    await fs.ensureDir(outputFolder);

    // Read the CSV file
    fs.createReadStream(csvFile)
        .pipe(csvParser({ headers: false })) // Disable headers
        .on('data', (row) => {
            const sittingNumber = row[0]; // First column
            const firstName = row[1];      // Second column
            const lastName = row[2];       // Third column
            students.push({ sittingNumber, firstName, lastName });
        })
        .on('end', async () => {
            // Process each student image
            for (const student of students) {
                // Construct the image filename based on sitting number
                const imagePattern = `${imagesFolder}/${student.sittingNumber}_*.jpg`; // Use wildcard for matching

                // Get the list of files in the images folder
                const files = await fs.readdir(imagesFolder);

                // Find the correct image file that starts with the sitting number
                const matchingFiles = files.filter(file => file.startsWith(`${student.sittingNumber}_`));

                if (matchingFiles.length > 0) {
                    // Process the first matching file
                    const imageFilename = `${imagesFolder}/${matchingFiles[0]}`;
                    const outputFilename = `${outputFolder}/processed_${student.sittingNumber}.jpg`; // Save to processed-images folder

                    await processImage(imageFilename, outputFilename, blueBackground, student.firstName, student.lastName);
                    console.log(`Processed: ${outputFilename.replace('.jpg', '.png')}`); // Log with PNG extension
                } else {
                    console.log(`Image not found for sitting number: ${student.sittingNumber}`); // Log missing file
                }
            }
        });
}

// Example usage
const csvFile = 'images.csv'; // Path to your CSV file
const imagesFolder = 'images'; // Path to your images folder (where all student images are located)
const blueBackground = 'blue_background.jpg'; // Path to your blue background image

processImagesFromFolder(csvFile, imagesFolder, blueBackground);
