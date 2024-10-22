const Jimp = require("jimp");
const fs = require("fs-extra");
const csvParser = require("csv-parser");

async function convertToPNG(imagePath) {
  const image = await Jimp.read(imagePath);
  const pngPath = imagePath.replace(".jpg", ".png");
  await image.writeAsync(pngPath);
  return pngPath;
}

async function createTransparentOverlay(width, height) {
  const overlay = new Jimp(width, height, "#ffffff");

  const ovalX = width / 2;
  const ovalY = height * 0.4;
  const ovalWidth = Math.min(width, height) * 0.4;
  const ovalHeight = Math.min(width, height) * 0.5;

  overlay.scan(0, 0, width, height, (x, y, idx) => {
    const dx = x - ovalX;
    const dy = y - ovalY;

    if (
      (dx * dx) / (ovalWidth * ovalWidth) +
        (dy * dy) / (ovalHeight * ovalHeight) <=
      1
    ) {
      overlay.bitmap.data[idx + 3] = 0;
    }
  });

  const cornerHeight = height * 0.25;
  overlay.scan(0, height - cornerHeight, width, height, (x, y, idx) => {
    overlay.bitmap.data[idx] = 255;
    overlay.bitmap.data[idx + 1] = 255;
    overlay.bitmap.data[idx + 2] = 255;
    overlay.bitmap.data[idx + 3] = 255;
  });

  overlay.scan(0, 0, width, height, (x, y, idx) => {
    const distanceSquared =
      (x - ovalX) ** 2 / ovalWidth ** 2 + (y - ovalY) ** 2 / ovalHeight ** 2;
    const isInsideOval = distanceSquared < 1;
    const isNearBorder = distanceSquared >= 1 && distanceSquared <= 1.05;

    if (isNearBorder) {
      overlay.bitmap.data[idx] = 0;
      overlay.bitmap.data[idx + 1] = 0;
      overlay.bitmap.data[idx + 2] = 0;
      overlay.bitmap.data[idx + 3] = 255;
    }
  });

  return overlay;
}

async function processImage(
  imagePath,
  outputPath,
  blueBackgroundPath,
  firstName,
  lastName
) {
  const pngImagePath = await convertToPNG(imagePath);

  const image = await Jimp.read(pngImagePath);
  const background = await Jimp.read(blueBackgroundPath);

  image.rotate(270);

  background.resize(image.bitmap.width, image.bitmap.height);

  image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, idx) => {
    const red = image.bitmap.data[idx + 0];
    const green = image.bitmap.data[idx + 1];
    const blue = image.bitmap.data[idx + 2];

    const isGreen = green > 200 && red < 150 && blue < 150;
    const isLightGreen =
      green > 180 &&
      red > 120 &&
      blue > 120 &&
      green - red > 50 &&
      green - blue > 50;
    const isNearGreen =
      green > 150 &&
      red < 130 &&
      blue < 130 &&
      green - red > 30 &&
      green - blue > 30;

    if (isGreen || isLightGreen || isNearGreen) {
      image.bitmap.data[idx + 3] = 0;
    }
  });

  background.composite(image, 0, 0);

  const overlay = await createTransparentOverlay(
    background.bitmap.width,
    background.bitmap.height
  );

  background.composite(overlay, 0, 0);

  const font = await Jimp.loadFont(Jimp.FONT_SANS_128_BLACK);
  firstName = `${firstName} `;
  firstName = firstName.charAt(0);
  const name = `${firstName} ${lastName}`;

  // Oval parameters
  const ovalX = background.bitmap.width / 2;
  const ovalY = background.bitmap.height * 0.75;
  const ovalWidth =
    Math.min(background.bitmap.width, background.bitmap.height) * 0.75;
  const ovalHeight =
    Math.min(background.bitmap.width, background.bitmap.height) * 0.45;

  const angleStep = Math.PI / name.length;
  const startAngle = Math.PI;

  for (let i = 0; i < name.length; i++) {
    const char = name[i];

    const charWidth = Jimp.measureText(font, char);
    const charHeight = Jimp.measureTextHeight(font, char);

    const angle = startAngle - i * angleStep;

    const currentX = ovalX + (ovalWidth / 2) * Math.cos(angle) - charWidth / 2;
    const currentY =
      ovalY + (ovalHeight / 2) * Math.sin(angle) - charHeight / 2 - 500;

    const charImage = new Jimp(charWidth, charHeight, 0x00000000);
    charImage.print(font, 0, 0, char);

    background.composite(charImage, currentX, currentY);
  }

  await background.writeAsync(outputPath.replace(".jpg", ".png"));
}

async function processImagesFromFolder(csvFile, imagesFolder, blueBackground) {
  const students = [];

  const outputFolder = "processed-images";
  await fs.ensureDir(outputFolder);

  fs.createReadStream(csvFile)
    .pipe(csvParser({ headers: false }))
    .on("data", (row) => {
      const sittingNumber = row[0];
      const firstName = row[1];
      const lastName = row[2];
      students.push({ sittingNumber, firstName, lastName });
    })
    .on("end", async () => {
      for (const student of students) {
        const imagePattern = `${imagesFolder}/${student.sittingNumber}_*.jpg`;

        const files = await fs.readdir(imagesFolder);

        const matchingFiles = files.filter((file) =>
          file.startsWith(`${student.sittingNumber}_`)
        );

        if (matchingFiles.length > 0) {
          const imageFilename = `${imagesFolder}/${matchingFiles[0]}`;
          const outputFilename = `${outputFolder}/processed_${student.sittingNumber}.jpg`;

          await processImage(
            imageFilename,
            outputFilename,
            blueBackground,
            student.firstName,
            student.lastName
          );
          console.log(`Processed: ${outputFilename.replace(".jpg", ".png")}`);
        } else {
          console.log(
            `Image not found for sitting number: ${student.sittingNumber}`
          );
        }
      }
    });
}

const csvFile = "images.csv";
const imagesFolder = "images";
const blueBackground = "blue_background.jpg";

processImagesFromFolder(csvFile, imagesFolder, blueBackground);
