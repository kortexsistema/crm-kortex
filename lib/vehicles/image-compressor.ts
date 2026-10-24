/**
 * Utilitário de compressão e redimensionamento inteligente de fotos no cliente (Browser).
 *
 * Otimiza as imagens antes do envio para o Supabase Storage:
 * 1. Redimensiona para resolução máxima de 1920x1080 mantendo aspect ratio.
 * 2. Converte para WebP (com fallback para JPEG) com taxa de qualidade de 85%.
 * 3. Economiza largura de banda do usuário e espaço de storage.
 * 4. Gera preview instantâneo via ObjectURL para renderização imediata na galeria.
 */

export interface CompressImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

export interface CompressedImageResult {
  file: File;
  previewUrl: string;
  originalSizeBytes: number;
  compressedSizeBytes: number;
  width: number;
  height: number;
}

/**
 * Carrega um objeto File em um HTMLImageElement.
 */
function carregarImagem(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Não foi possível carregar a imagem. Verifique se o arquivo está corrompido."));
    };

    img.src = objectUrl;
  });
}

/**
 * Calcula as novas dimensões preservando o aspect ratio original.
 */
export function calcularDimensoes(
  larguraAtual: number,
  alturaAtual: number,
  maxLargura: number,
  maxAltura: number,
): { largura: number; altura: number } {
  if (larguraAtual <= maxLargura && alturaAtual <= maxAltura) {
    return { largura: larguraAtual, altura: alturaAtual };
  }

  const ratio = Math.min(maxLargura / larguraAtual, maxAltura / alturaAtual);
  return {
    largura: Math.max(1, Math.round(larguraAtual * ratio)),
    altura: Math.max(1, Math.round(alturaAtual * ratio)),
  };
}

/**
 * Converte um Canvas em Blob com fallback WebP -> JPEG.
 */
function canvasParaBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<{ blob: Blob; mimeType: "image/webp" | "image/jpeg" }> {
  return new Promise((resolve, reject) => {
    // Tenta primeiro WebP
    canvas.toBlob(
      (blobWebp) => {
        if (blobWebp && blobWebp.type === "image/webp") {
          resolve({ blob: blobWebp, mimeType: "image/webp" });
          return;
        }

        // Fallback para JPEG
        canvas.toBlob(
          (blobJpeg) => {
            if (blobJpeg) {
              resolve({ blob: blobJpeg, mimeType: "image/jpeg" });
            } else {
              reject(new Error("Falha ao exportar blob da imagem a partir do canvas."));
            }
          },
          "image/jpeg",
          quality,
        );
      },
      "image/webp",
      quality,
    );
  });
}

/**
 * Redimensiona e comprime uma foto no navegador.
 */
export async function compressVehicleImage(
  file: File,
  options?: CompressImageOptions,
): Promise<CompressedImageResult> {
  const maxWidth = options?.maxWidth ?? 1920;
  const maxHeight = options?.maxHeight ?? 1080;
  const quality = options?.quality ?? 0.85;

  const originalSizeBytes = file.size;
  const img = await carregarImagem(file);

  const { largura, altura } = calcularDimensoes(
    img.naturalWidth || img.width,
    img.naturalHeight || img.height,
    maxWidth,
    maxHeight,
  );

  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Contexto 2D do Canvas indisponível no navegador.");
  }

  // Melhora nitidez no redimensionamento
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.drawImage(img, 0, 0, largura, altura);

  const { blob, mimeType } = await canvasParaBlob(canvas, quality);

  const ext = mimeType === "image/webp" ? "webp" : "jpg";
  const nomeOriginalSemExt = file.name.replace(/\.[^/.]+$/, "");
  const novoNome = `${nomeOriginalSemExt}.${ext}`;

  const compressedFile = new File([blob], novoNome, {
    type: mimeType,
    lastModified: Date.now(),
  });

  const previewUrl = URL.createObjectURL(compressedFile);

  return {
    file: compressedFile,
    previewUrl,
    originalSizeBytes,
    compressedSizeBytes: compressedFile.size,
    width: largura,
    height: altura,
  };
}
