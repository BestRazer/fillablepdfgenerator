const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const sizeOf = require('image-size');
const { Image } = require('image-js');
const express = require('express');
const multer  = require('multer');
const path = require('path');
const sharp = require('sharp');
const app = express();
const upload = multer({ dest: 'uploads/' });
const port = 3000;

const config = {
  lang: 'eng',
  oem: 1,
  psm: 3,
}

function isAnythingAbove(line, image, threshold) {
    for (let y = line.y0 - 1; y >= line.y0 - threshold && y >= 0; y--) {
      for (let x = line.x0; x <= line.x1; x++) {
        const pixel = image.getPixelXY(x, y);
        const isWhite = pixel.every(value => value > 200); // Adjust this value as needed
        if (!isWhite) {
          return true;
        }
      }
    }
    return false;
  }

async function createForm(imagePath, minLineLength) {
    // Load the image
    const image = await Image.load(imagePath);
    // Convert the image to grayscale
    const grey = image.grey();
    // Apply the Sobel operator to detect edges
    const edges = grey.sobelFilter();

    // Scan the image for continuous straight lines
    const lines = [];
    // const minLineLength = 250; // Minimum length of a line to be considered
    const anythingAboveThreshold = 10; // Adjust this value as needed
    for (let y = 0; y < edges.height; y++) {
        let start = null;
        for (let x = 0; x < edges.width; x++) {
            const pixel = edges.getPixelXY(x, y);
            const isEdge = pixel[0] > 128; // Edge if red component is greater than 128
            if (isEdge && start === null) {
                start = x;
            } else if (!isEdge && start !== null) {
                if (x - start >= minLineLength) { // Only add the line if it's long enough
                    const line = { x0: start, y0: y, x1: x, y1: y };
                    // Only add the line if it's not too close to text
                    if (!isAnythingAbove(line, image, anythingAboveThreshold)) {
                        lines.push(line);
                    }
                }
                start = null;
            }
        }
    }

    console.log(`Number of lines: ${lines.length}`);

    // Merge lines that are close together
    const mergedLines = [];
    const lineMergeThreshold = 10; // Adjust this value as needed
    for (const line of lines) {
    let merged = false;
    for (const mergedLine of mergedLines) {
        const isClose = Math.abs(line.y0 - mergedLine.y0) < lineMergeThreshold;
        const isOverlap = line.x1 > mergedLine.x0 && line.x0 < mergedLine.x1;
        if (isClose && isOverlap) {
        mergedLine.x0 = Math.min(line.x0, mergedLine.x0);
        mergedLine.x1 = Math.max(line.x1, mergedLine.x1);
        merged = true;
        break;
        }
    }
    if (!merged) {
        mergedLines.push(line);
    }
    }

    console.log(`Number of merged lines: ${mergedLines.length}`);

    // Create a new PDFDocument
    const pdfDoc = await PDFDocument.create();

    // Embed the font into the PDF
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Add a new page with the same dimensions as the image
    const dimensions = sizeOf(imagePath);
    const page = pdfDoc.addPage([dimensions.width, dimensions.height]);

    // Embed the image into the PDF
    const jpgImage = await pdfDoc.embedJpg(fs.readFileSync(imagePath));
    page.drawImage(jpgImage, {
        x: 0,
        y: 0,
        width: dimensions.width,
        height: dimensions.height,
    });

    const fields = [];
    const fieldMergeThreshold = 10; // Adjust this value as needed
    
    mergedLines.forEach((line, index) => {
        const existingField = fields.find(field => Math.abs(field.y - (dimensions.height - line.y0)) < fieldMergeThreshold);
        if (!existingField) {
            const form = pdfDoc.getForm();
            const textField = form.createTextField(`field${index}`);
            textField.addToPage(page, { x: line.x0, y: dimensions.height - line.y0, width: line.x1 - line.x0, height: 20 });
            fields.push({ x: line.x0, y: dimensions.height - line.y0 });
        }
    });

    // Remove the form marking (optional)
    // pdfDoc.getForm().flatten(); // Comment this line

    // Serialize the PDFDocument to bytes (a Uint8Array)
    const pdfBytes = await pdfDoc.save();

    // Write the bytes to a file
    fs.writeFileSync('output.pdf', pdfBytes);
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  app.post('/upload', upload.single('image'), async (req, res) => {
    try {
      // Convert the uploaded file to jpg
      const jpgPath = path.join(path.dirname(req.file.path), `${path.basename(req.file.path, path.extname(req.file.path))}.jpg`);
      await sharp(req.file.path)
        .jpeg()
        .toFile(jpgPath);
  
      // Delete the original uploaded file
      fs.unlinkSync(req.file.path);
  
      // Replace 'input.jpg' with the path to the converted jpg file
      await createForm(jpgPath, req.body.minLineLength);
  
      // Delete the converted jpg file
      fs.unlinkSync(jpgPath);
  
      // Send the created PDF as a download
      res.download('output.pdf', (err) => {
        if (err) {
          fs.unlinkSync('output.pdf');
          res.status(500).send('An error occurred while creating the form');
        }
        // Delete the PDF file after it's been downloaded
        fs.unlinkSync('output.pdf');
      });
    } catch (error) {
      console.error(error);
      res.status(500).send('An error occurred while creating the form');
    }
  });

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });