# Seguridad

## Alcance

Extensión no oficial de aprendizaje para Crunchyroll. El usuario mantiene su sesión en el sitio. No hay inicio de sesión propio, servidor de aplicación, claves API incrustadas ni automatización de credenciales.

## Controles implementados

- Permisos declarados en `manifest.json`, limitados a almacenamiento local y los dominios necesarios para el funcionamiento.
- El worker comprueba el origen HTTPS del frame que envía mensajes, no solo el de su pestaña.
- Las URLs de subtítulos deben ser HTTPS, estar en Crunchyroll o VRV y no contener credenciales ni puertos alternativos. Las peticiones de subtítulos no siguen redirecciones y omiten cookies.
- Las solicitudes de red tienen tiempo máximo de espera.
- Se limita la longitud de las palabras y frases enviadas al traductor.
- El texto de subtítulos, reconocimiento y traducciones se escapa antes de insertarlo en el panel.
- El diccionario y el conversor de pronunciación están incluidos; no se ejecuta JavaScript descargado de un traductor.
- Las pruebas de navegador arrancan un perfil temporal aislado. Sus certificados y medios se crean fuera del repositorio.
- `.gitignore` aplica una lista cerrada; `tools/check_publication.py` revisa índice, commits, metadatos y blobs, incluidos los no alcanzables.
- Los activos binarios y diccionarios revisados tienen hashes en `.publication-assets.json`. Cambiarlos requiere otra revisión; el hash no sustituye la inspección del contenido.

## Límites de seguridad

El puente `postMessage` observa datos dentro de la página; **no es una frontera de confianza frente a código que ya corre en esa página**. Se comprueban emisor/origen y los destinos antes de hacer solicitudes, pero no se puede garantizar la integridad de Crunchyroll, del navegador o de otras extensiones.

El panel usa Shadow DOM abierto para aislar estilos, no para esconder información de la página. No introduzcas datos confidenciales en las respuestas o en subtítulos propios.

El control de práctica evita saltos accidentales con una frase abierta. No pretende impedir que el dueño del navegador desactive la extensión o modifique su código.

Ningún escáner textual garantiza detectar todos los secretos. Imágenes, metadatos, mensajes de commit y cambios en el propio filtro deben revisarse manualmente. No uses `git add -f` para introducir archivos excluidos.

## Antes de publicar

1. Ejecuta `npm test`, las pruebas Python y el E2E pertinente.
2. Ejecuta `npm audit` y revisa cambios de dependencias.
3. Revisa nombres de archivos, diff e imágenes: no debe haber datos de cuentas, configuración privada, medios reales ni resultados temporales.
4. Ejecuta el control de publicación antes del commit y de nuevo antes del push.
5. Comprueba el commit y contenido remoto después del push.

No publiques perfiles de navegador, cookies, tokens, claves, certificados, `.env`, notas personales, rutas privadas o datos de infraestructura. Los nombres de servicios públicos usados por el programa no son credenciales.

## Reportar un problema

Para fallos sin datos sensibles, abre un issue con pasos reproducibles y fixtures sintéticas. Para una vulnerabilidad que implique credenciales o datos privados, utiliza el aviso privado de seguridad del repositorio si está habilitado; si no lo está, solicita al mantenedor un canal privado sin describir el secreto públicamente. Nunca adjuntes contraseñas ni cookies a un issue.

No se promete un plazo de respuesta ni una auditoría de seguridad certificada.
