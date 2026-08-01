# docs/ — el sitio de YUSEPE Bento

Landing estática servida por **GitHub Pages** desde esta carpeta
(*Settings → Pages → Source: Deploy from a branch → `master` / `/docs`*).

Sin build, sin dependencias, sin generador: lo que hay acá es lo que se
publica. HTML plano con todo el contenido, un CSS, y módulos ES que sólo
agregan comportamiento a lo que ya está pintado.

```
index.html     todo el contenido y la estructura
styles.css     tokens de tema (claro/oscuro) + estilos
icon.png       favicon y og:image (copia de build/icon.png)
js/
├── main.js    entrada: importa el resto
├── theme.js   toggle claro/oscuro (el valor inicial lo pone el <head>)
├── reveal.js  aparición al scrollear
├── bento.js   el mosaico del hero: terminal que teclea + barajar
├── loop.js    demo del loop multiagente (roster + hilo)
├── tasks.js   demo de tareas → launchText
├── persist.js demo de workspaces vivos
└── palette.js command palette ⌘K
```

## Previsualizar

Los módulos ES no cargan desde `file://`, así que hace falta un servidor:

```bash
python3 -m http.server 6700 -d docs   # http://localhost:6700
```

## Rutas

Todas relativas (`styles.css`, `js/main.js`), porque el sitio vive bajo
`/YUSEPE-bento/` y no en la raíz del dominio. Una ruta con `/` adelante
funciona en local y se rompe publicada.

`.nojekyll` desactiva el procesamiento de Jekyll: acá no hay plantillas que
procesar y sin ese archivo Pages ignora todo lo que empiece con `_`.
