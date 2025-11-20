import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import chalk from "chalk";
import sharp from "sharp";

// Sizes configuration
const sizes = [
  { name: "favicon-32x32", width: 32, height: 32, rel: "icon" },
  {
    name: "favicon-48x48",
    width: 48,
    height: 48,
    rel: "apple-touch-icon",
    includeToManifest: true,
  },
  {
    name: "favicon-72x72",
    width: 72,
    height: 72,
    rel: "apple-touch-icon",
    includeToManifest: true,
  },
  {
    name: "favicon-96x96",
    width: 96,
    height: 96,
    rel: "apple-touch-icon",
    includeToManifest: true,
  },
  { name: "favicon-144x144", width: 144, height: 144, includeToManifest: true },
  { name: "favicon-192x192", width: 192, height: 192, includeToManifest: true },
  {
    name: "favicon-256x256",
    width: 256,
    height: 256,
    rel: "apple-touch-icon",
    includeToManifest: true,
  },
  {
    name: "favicon-384x384",
    width: 384,
    height: 384,
    rel: "apple-touch-icon",
    includeToManifest: true,
  },
  {
    name: "favicon-512x512",
    width: 512,
    height: 512,
    rel: "apple-touch-icon",
    includeToManifest: true,
  },
];

export async function generateFavicons(
  projectPath: string,
  outputDir: string,
  appName: string = "MCP Server"
) {
  try {
    // Find input file (light mode) - check SVG first, then raster formats
    const iconFiles = [
      "icon.svg",
      "icon.png",
      "icon.jpg",
      "icon.jpeg",
      "icon.webp",
      "logo.svg",
      "logo.png",
      "logo.jpg",
      "logo.jpeg",
      "logo.webp",
    ];

    let input: string | null = null;
    let inputDark: string | null = null;
    let ext = "";
    let baseName = "";
    let isSvg = false;

    for (const file of iconFiles) {
      const filePath = path.join(projectPath, file);
      if (fs.existsSync(filePath)) {
        input = filePath;
        ext = path.parse(file).ext;
        baseName = path.parse(file).name;
        isSvg = ext === ".svg";

        // Check for dark variant
        const darkPath = path.join(projectPath, `${baseName}_dark${ext}`);
        if (fs.existsSync(darkPath)) {
          inputDark = darkPath;
        }
        break;
      }
    }

    if (!input) {
      console.log(
        chalk.gray(
          "ℹ️  No icon file found (icon.svg/png/jpg/webp or logo.svg/png/jpg/webp). Skipping favicon generation."
        )
      );
      return;
    }

    const hasDarkMode = inputDark !== null;
    if (hasDarkMode) {
      console.log(
        chalk.cyan(
          `✨ Generating favicons from ${path.basename(input)} (light) and ${path.basename(inputDark!)} (dark)...`
        )
      );
    } else {
      console.log(
        chalk.cyan(`✨ Generating favicons from ${path.basename(input)}...`)
      );
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Calculate hashsum of the input file
    const hash = crypto.createHash("md5");
    const inputBuffer = fs.readFileSync(input);
    hash.update(inputBuffer);
    const hashsum = hash.digest("hex");

    // Validate input file size
    const imageMetadata = await sharp(input).metadata();
    if (!imageMetadata.width || !imageMetadata.height) {
      console.error(chalk.red("❌ Could not read image metadata"));
      return;
    }

    if (imageMetadata.width < 512 || imageMetadata.height < 512) {
      console.warn(
        chalk.yellow(
          "⚠️  Image is smaller than 512x512. Generated icons may be blurry."
        )
      );
    }

    if (imageMetadata.width !== imageMetadata.height) {
      console.warn(
        chalk.yellow(
          "⚠️  Image is not square. It will be resized to square, potentially distorting it."
        )
      );
    }

    const css: string[] = [];
    // For SVG files, we'll convert to PNG for favicon generation
    const outputExt = isSvg ? ".png" : ext;

    // Generate resized images for light mode
    await Promise.all(
      sizes.map(async (size) => {
        const { name, width, height, rel, includeToManifest } = size;
        const filename = `${name}${outputExt}`;
        const outputPath = path.join(outputDir, filename);

        // Convert SVG to PNG, or use original format for raster images
        if (isSvg) {
          await sharp(input)
            .resize(width, height)
            .png({ quality: 90 })
            .toFile(outputPath);
        } else if (ext === ".jpg" || ext === ".jpeg") {
          await sharp(input)
            .resize(width, height)
            .jpeg({ quality: 90 })
            .toFile(outputPath);
        } else {
          await sharp(input)
            .resize(width, height)
            .png({ quality: 90 })
            .toFile(outputPath);
        }

        // Generate dark mode variant if available
        if (hasDarkMode && inputDark) {
          const darkFilename = `${name}_dark${outputExt}`;
          const darkOutputPath = path.join(outputDir, darkFilename);

          if (isSvg) {
            await sharp(inputDark)
              .resize(width, height)
              .png({ quality: 90 })
              .toFile(darkOutputPath);
          } else if (ext === ".jpg" || ext === ".jpeg") {
            await sharp(inputDark)
              .resize(width, height)
              .jpeg({ quality: 90 })
              .toFile(darkOutputPath);
          } else {
            await sharp(inputDark)
              .resize(width, height)
              .png({ quality: 90 })
              .toFile(darkOutputPath);
          }
        }

        // If includeToManifest: true, then don't add the link to the CSS
        if (includeToManifest && !rel) {
          return;
        }

        // If rel is icon, then add type="image/png" (always PNG for favicons, even if source was SVG)
        if (rel === "icon") {
          // Light mode (default)
          css.push(
            `<link rel="${rel}" type="image/png" href="/${name}${outputExt}" />`
          );
          // Dark mode variant
          if (hasDarkMode) {
            css.push(
              `<link rel="${rel}" type="image/png" href="/${name}_dark${outputExt}" media="(prefers-color-scheme: dark)" />`
            );
          }
        } else {
          // Light mode (default)
          css.push(
            `<link rel="${rel}" sizes="${width}x${height}" href="/${name}${outputExt}" />`
          );
          // Dark mode variant
          if (hasDarkMode) {
            css.push(
              `<link rel="${rel}" sizes="${width}x${height}" href="/${name}_dark${outputExt}" media="(prefers-color-scheme: dark)" />`
            );
          }
        }
      })
    );

    // Also generate a standard favicon.ico for legacy support
    // sharp can't write .ico directly easily without plugins, but we can resize to 32x32 png
    // and rename it or just rely on the png favicons which modern browsers support.
    // However, the server setup logic looks for favicon.ico.
    // Let's generate a favicon.ico specifically if possible, or just use the 32x32 png served as ico?
    // Actually, sharp can output ico if configured, or we can just save the 32x32 png as favicon.ico
    // Browsers are forgiving, but let's stick to the sizes list.
    // The McpServer logic I wrote previously looks for favicon.ico in root.
    // Here we are generating into outputDir.

    // Let's copy the 32x32 as favicon.ico for compatibility if needed
    // But modern browsers use the link tags.

    // Generate manifest.webmanifest
    const imagesForManifest = sizes.filter((size) => size.includeToManifest);

    const manifestIcons: any[] = imagesForManifest.map((image) => {
      const { name, width, height } = image;
      return {
        src: `/${name}${outputExt}?v=${hashsum}`,
        sizes: `${width}x${height}`,
        type: "image/png", // Always PNG for favicons
      };
    });

    // Add dark mode icons to manifest if available
    if (hasDarkMode) {
      const darkIcons = imagesForManifest.map((image) => {
        const { name, width, height } = image;
        return {
          src: `/${name}_dark${outputExt}?v=${hashsum}`,
          sizes: `${width}x${height}`,
          type: "image/png", // Always PNG for favicons
          purpose: "any maskable",
        };
      });
      manifestIcons.push(...darkIcons);
    }

    const manifest = {
      name: appName,
      short_name: appName,
      icons: manifestIcons,
    };

    fs.writeFileSync(
      path.join(outputDir, "manifest.webmanifest"),
      JSON.stringify(manifest, null, 2)
    );

    css.push(
      `<link rel="manifest" href="/manifest.webmanifest" crossorigin="anonymous" />`
    );

    // Save the CSS snippet to a file so the server can inject it?
    // Or maybe we don't need to inject it if the server serves these files and the client (Inspector) knows to look for them.
    // The Inspector currently looks for favicon.ico or uses serverUrl/favicon.ico.
    // If we want the inspector to use the manifest, we'd need to update the inspector too.
    // But for now, let's just ensure the files are there.

    // Generate favicon.ico from 32x32 light version (for legacy browser support)
    try {
      const favicon32Path = path.join(outputDir, `favicon-32x32${outputExt}`);
      if (fs.existsSync(favicon32Path)) {
        // Copy the PNG as favicon.ico (browsers accept PNG as favicon.ico)
        fs.copyFileSync(favicon32Path, path.join(outputDir, "favicon.ico"));
      } else {
        // Fallback: generate directly from input
        await sharp(input)
          .resize(32, 32)
          .png()
          .toFile(path.join(outputDir, "favicon.ico"));
      }
    } catch (error) {
      console.warn(chalk.yellow("⚠️  Could not generate favicon.ico"));
    }

    // Copy the original input files to outputDir so they're available for other uses
    fs.copyFileSync(input, path.join(outputDir, `icon${ext}`));

    // Copy dark variant if it exists
    if (hasDarkMode && inputDark) {
      fs.copyFileSync(inputDark, path.join(outputDir, `icon_dark${ext}`));
    }

    console.log(chalk.green("✅ Favicons generated successfully!"));
    if (hasDarkMode) {
      console.log(chalk.gray("   Dark mode variants included"));
    }
    return { css: css.join("\n"), outputDir, hasDarkMode };
  } catch (error) {
    console.error(chalk.red("❌ Error generating favicons:"), error);
  }
}
