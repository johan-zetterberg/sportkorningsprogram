export function fitImageDimensions(image, maxW, maxH) {
  const ratio = Number(image?.w) > 0 && Number(image?.h) > 0 ? Number(image.w) / Number(image.h) : 1;
  const widthLimit = Number(maxW) > 0 ? Number(maxW) : null;
  const heightLimit = Number(maxH) > 0 ? Number(maxH) : null;

  if (widthLimit && heightLimit) {
    const boxRatio = widthLimit / heightLimit;
    if (boxRatio > ratio) {
      return { w: heightLimit * ratio, h: heightLimit };
    }
    return { w: widthLimit, h: widthLimit / ratio };
  }

  if (heightLimit) return { w: heightLimit * ratio, h: heightLimit };
  if (widthLimit) return { w: widthLimit, h: widthLimit / ratio };
  return { w: ratio, h: 1 };
}
