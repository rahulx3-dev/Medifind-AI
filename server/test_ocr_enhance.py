import os
from PIL import Image, ImageEnhance, ImageFilter
from paddleocr import PaddleOCR

img_path = 'C:/Users/HP/mfai_web/server/uploads/prescriptions/rx-1790497738763-331964841.jpg'
ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=False)

im = Image.open(img_path).convert('RGB')

# Multi-pass preprocessing tests
enh_contrast = ImageEnhance.Contrast(im).enhance(1.6)
enh_sharp = ImageEnhance.Sharpness(enh_contrast).enhance(1.4)
out_path = 'C:/Users/HP/mfai_web/server/uploads/prescriptions/test_enh.jpg'
enh_sharp.save(out_path, quality=95)

res = ocr.ocr(out_path, cls=True)
texts = [line[1][0] for block in res if block for line in block]
print("--- ALL OCR TEXTS IN ENHANCED IMAGE ---")
for i, t in enumerate(texts):
    print(f"{i}: {t}")

print("\n--- CHECKING DRUGS ---")
for t in texts:
    tl = t.lower()
    if any(k in tl for k in ['cefix', 'cetix', 'domper', 'panto', 'ors', 'powder', 'packet', 'oral', 'dom']):
        print("  ->", t)
