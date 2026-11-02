# Privacidad

Esta extensión no tiene servidor propio ni añade analítica. Eso **no significa que todo ocurra offline**.

## Datos y destinos

| Operación | Qué utiliza o envía | Destino y persistencia |
| --- | --- | --- |
| Leer subtítulos | URLs de pistas y archivos de subtítulos que entrega el reproductor | Crunchyroll, VRV, el CDN de subtítulos `vod-fy-mod.crunchyrollcdn.com` o las pistas `/api/timedtext` de YouTube; sin cookies añadidas en las peticiones de la extensión. Los textos se mantienen en memoria durante la práctica. |
| Palabra bajo el ratón o pulsada | La palabra inglesa, incluso si existe en el diccionario incluido, para ampliar sentidos | Google Translate; respuesta cacheada en `chrome.storage.local` con clave `w:`. |
| Frase completa sin traducción oficial | Texto inglés de la frase | Google Translate; respuesta cacheada con clave `t:`. |
| Reconocimiento de voz | Voz y resultados gestionados por la Web Speech API | Depende del navegador y de su servicio de reconocimiento; puede procesarse remotamente. La extensión no guarda grabaciones. |
| Botón de escuchar | Palabra o frase leída mediante `speechSynthesis` | Depende de la voz local/remota que proporcione el navegador. |
| Ajustes y estadísticas | Configuración, conteo de intentos/aprobaciones, fechas de práctica y episodio actual | Solo almacenamiento local de la extensión. |
| Progreso de episodios | Identificador de episodio y marcas de tiempo de frases aprobadas, con nota | Claves `ep:` en almacenamiento local. |

La solicitud de traducción utiliza un endpoint de Google sin clave de API. **No es una integración contratada ni un servicio con disponibilidad garantizada**; puede cambiar, bloquear solicitudes o devolver errores. Las traducciones automáticas pueden perder contexto.

El reproductor, el navegador y los servicios externos pueden tener sus propias solicitudes y políticas, ajenas a esta extensión. No se pide ni se incluye una contraseña de Crunchyroll o YouTube en el código o en el repositorio.

## Qué no se guarda por este código

- No guarda audio del micrófono como archivos.
- No escribe contraseñas, tokens de cuenta ni cookies en el almacenamiento de la extensión.
- No sube videos ni descarga episodios.
- No exporta el progreso a una cuenta o servidor del proyecto.

El texto que reconoció el navegador y lo que escribiste se muestran en memoria durante el ejercicio. La caché de traducción sí conserva las palabras/frases consultadas y sus traducciones.

## Borrar datos

El popup permite reiniciar el progreso del episodio actual; **eso no borra estadísticas globales ni la caché de traducciones**. Para eliminar todos los datos puedes quitar la extensión desde la página de extensiones del navegador. También puedes abrir las herramientas de desarrollo de su trabajador de servicio y borrar su almacenamiento local. No incluyas volcados de ese almacenamiento en un issue público.

## Publicación de errores

Describe el problema sin compartir correo, contraseña, código de acceso, cookies, URLs firmadas, respuestas completas de reproducción o capturas de tu perfil. Usa un fragmento inventado o los fixtures de `tests/e2e/fixtures/`.

Las capturas del README son sintéticas y no proceden de una cuenta real.
