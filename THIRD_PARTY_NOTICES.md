# Procedencia y avisos de terceros

## CMU Pronouncing Dictionary

- Proyecto: `cmusphinx/cmudict` en GitHub.
- Revisión de origen fijada: `74790861f652b15e4ac49015a90074ad62a27690`.
- Archivo incluido: `data/cmudict.txt`.
- Transformación: se eliminan comentarios y pronunciaciones alternativas identificadas con paréntesis; se conserva una entrada por palabra.
- Licencia y aviso originales completos: [data/CMUDICT-LICENSE](data/CMUDICT-LICENSE).
- Regeneración: `python tools/build_dict.py`. La herramienta descarga esa revisión concreta, no la rama más reciente.

El diccionario es de terceros; no se presenta como obra propia. Las pronunciaciones respelladas y el AFI se generan en ejecución mediante `src/pron.js`. No se atribuye a CMU la validación de esas conversiones.

## Vocabulario de Speak y lógica del proyecto

`data/speak-dict.json`, la puntuación y el estilo de ayuda se adaptan de la app Speak del mismo autor. El vocabulario incluido se ha revisado como parte de esta publicación; no incluye el perfil, las estadísticas o las grabaciones de esa aplicación. No se requiere acceso a otro repositorio para usar esta extensión.

No se añade una licencia global al código propio o a ese vocabulario mediante esta publicación. Los avisos de los componentes de terceros conservan su alcance propio.

## Dependencias de desarrollo

`puppeteer-core` y sus dependencias se usan para pruebas de navegador. No se integran como código de ejecución de la extensión ni se versiona `node_modules`. Las versiones e integridades están en `package-lock.json`; sus licencias y avisos se distribuyen en los paquetes instalados por npm. Node.js, Python, Chrome/Edge, FFmpeg, OpenSSL y Pillow se obtienen por separado y tienen sus propios términos.

## Servicios y marcas

Crunchyroll y Google son servicios externos y sus nombres se usan para identificar la compatibilidad o los destinos de red. No existe afiliación, patrocinio ni garantía de compatibilidad. La extensión no concede derechos sobre episodios, subtítulos ni voces.

La traducción utiliza un endpoint de Google sin clave de API, no una API oficial contratada por este proyecto. Puede cambiar o no estar disponible. Consulta [PRIVACY.md](PRIVACY.md) antes de enviar texto.

## Medios e iconos

Los iconos EN son generados por `tools/make_icons.py`; no se incluye el logo de Crunchyroll. Las capturas documentales muestran una señal de video sintética y frases de prueba, no fotogramas de anime, perfiles ni material privado. Los binarios se revisan y fijan por hash antes de publicarlos.
