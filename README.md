# Carlos Ríos · QA Automation Engineer

Portafolio personal: **https://carlosrios-dev.github.io**

Sitio estático (HTML, CSS y JavaScript sin frameworks ni build step) con un hero que avanza cuadro a cuadro según el scroll, versión bilingüe ES/EN, una suite de pruebas interactiva y CV descargable en PDF.

## Estructura

```
index.html          Página única
assets/site.css     Estilos y animaciones
assets/site.js      Scroll del hero, animaciones, interacción y formulario
assets/i18n.js      Textos en español e inglés
assets/cv/          CV en PDF (ES / EN)
assets/img/         Imágenes del sitio
assets/hero-scrub.mp4  Video del hero
```

## Ver en local

```bash
python -m http.server 8080
```

Luego abre http://localhost:8080. Si abres `index.html` con doble clic, verás la versión con imagen fija del hero: el navegador bloquea la carga del video desde archivos locales.

Visuales generados con IA. Código escrito a mano.
