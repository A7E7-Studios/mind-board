The AVIF fixture is an original 240 × 160 solid-color image generated for these tests. It is covered by the project's MIT license.

Regenerate with Pillow 12.3 or later and AVIF support:

```python
from PIL import Image

Image.new('RGB', (240, 160), (90, 130, 170)).save('tests/fixtures/reference.avif', quality=80)
```

PNG fixtures are generated using only Node's standard library in `tests/fixtures.ts`. JPEG and WebP fixtures are encoded by the browser during testing. The GIF fixture is a one-pixel transparent image. Visual documentation uses original canvas drawings from `tests/visual.spec.ts`.
