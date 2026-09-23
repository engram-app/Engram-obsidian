<div align="center">

# Engram Vault Sync

![Engram Vault Sync: tus notas son la memoria de tu IA, sincronizadas en todas partes, leídas y escritas por tu IA](../../assets/vault-banner.gif)

**Sincroniza tu bóveda en todos tus dispositivos y deja que cualquier IA lea y escriba en ella.** Tus notas se convierten en una memoria que tu IA puede buscar, citar y ampliar.

**[Empieza gratis en engram.page →](https://engram.page)** · Sin tarjeta de crédito, listo en minutos.

[Instalación](#instalación) · [Conecta tu IA](#conecta-tu-ia) · [API](https://engram.page/docs/api) · [Guía de uso](../user-guide.md) · [Autoalojamiento](https://engram.page/docs/self-host/) · [Discord](https://discord.gg/NKWcU2mm7N)

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · **Español** · [Português](README.pt-BR.md) · [Русский](README.ru.md) · [Italiano](README.it.md)

<a href="https://www.youtube.com/watch?v=rwnPeZ-8Lqo"><img src="../../assets/setup-video.jpg" alt="Vídeo de instalación: conectar Obsidian a cualquier IA" width="640"></a>

</div>

> La interfaz del plugin está por ahora solo en inglés. Que este documento esté traducido no significa que el programa en sí esté localizado.

## Qué obtienes

- **Tu IA trabaja *dentro* de tu bóveda.** Conecta Claude, Cursor o ChatGPT mediante [MCP](#conecta-tu-ia). Lee tus notas como contexto y escribe otras nuevas:
- **Tus notas en todos tus dispositivos.** Escribes en el portátil y está en el móvil, y los cambios que hace tu IA también llegan.
- **Encuentra cualquier cosa, por significado o por la palabra exacta.** Pulsa el icono de búsqueda y elige un modo: *Semántico* lleva de *«nuestra política de reembolsos»* a **«Manual de atención al cliente»**, aunque la nota no escriba nunca la palabra «política». *Palabra clave* hace coincidencia exacta en local (funciona sin conexión y no consume cuota). *Híbrido* combina ambos.
- **Tu bóveda es programable.** Una [API REST y WebSocket](https://engram.page/docs/api) completa abarca cada nota: automatiza, integra o construye aplicaciones sobre tu propio conocimiento.

```text
Tú       Reúne lo que sabemos de la cuenta Henderson.

Claude   🔎  bóveda consultada ·  4 notas encontradas
         Están en plena renovación, señalaron carencias en la puesta
         en marcha durante el segundo trimestre y preguntaron por el
         complemento de analítica.

Tú       Crea una nota centrada en los riesgos de la renovación.

Claude   📝  creada «Henderson: riesgos de la renovación»  ✓
         Enlazada a las cuatro notas de origen.
```

<video src="../../assets/showcase-file-creation.webm" width="800" autoplay loop muted playsinline></video>

Nunca se sobrescribe nada en silencio. Los cambios hechos sin conexión se sincronizan al volver a conectar. Tus notas van solo a Engram, nunca a un tercero, y no hay ningún rastreo.

## Instalación

**1. Consigue una cuenta de Engram.** Alojada en **[engram.page](https://engram.page)** (plan gratuito, nada que instalar), o aloja tú mismo el [backend de código disponible](https://github.com/engram-app/engram) para que tus notas no salgan nunca de tu propio equipo.

**2. Conéctate.** Abre *Settings → Engram Vault Sync*. **Alojado:** pulsa **Sign in** en la pestaña Cloud. **Autoalojado:** indica la dirección de tu servidor y tu clave en la pestaña Self-hosted. En ambos casos el plugin te guía por la primera sincronización; no se envía nada hasta que lo confirmas.

A partir de ahí, la sincronización ocurre sola mientras trabajas.

**¿Prefieres verlo?** El [vídeo de instalación](https://www.youtube.com/watch?v=rwnPeZ-8Lqo) cubre los dos pasos de principio a fin.

## Conecta tu IA

Engram habla **MCP (Model Context Protocol)**, el estándar abierto con el que Claude, Cursor, ChatGPT y otras aplicaciones llegan a herramientas externas. Una vez conectada, tu IA puede buscar tus notas, escribir otras nuevas y actualizar las existentes, directamente en tu propia bóveda.

Apunta tu cliente al servidor MCP de Engram (`https://mcp.engram.page` en el servicio alojado). Las guías paso a paso de cada aplicación están en la **[documentación de integraciones](https://engram.page/docs/integrations)**.

<video src="../../assets/showcase-mcp.webm" width="800" autoplay loop muted playsinline></video>

## Privacidad

- **Uso de la red y cuentas.** El plugin habla solo con tu servidor de Engram, con nada más, sin intermediarios. Te conectas con tu cuenta de Engram mediante OAuth, y eso funciona en todos los planes. También se admiten claves de API, pero en Engram Cloud requieren el plan Pro; los servidores autoalojados no tienen ese límite.
- **Sin telemetría.** El registro remoto opcional (desactivado por defecto) envía solo eventos de error y de ciclo de vida, y únicamente a tu servidor.
- **Privacidad del servicio alojado.** Consulta [engram.page/privacy](https://engram.page/privacy). Los planes de pago amplían los límites de almacenamiento y búsqueda; autoalojarse es gratis.

## Más

- **[Conecta tu IA](https://engram.page/docs/integrations)**: configuración de MCP para Claude, Cursor, ChatGPT, Windsurf y más.
- **[Referencia de la API](https://engram.page/docs/api)**: construye sobre la API REST y WebSocket.
- **[Guía de uso](../user-guide.md)**: asistentes de IA, conflictos, el Sync Center, resolución de problemas.
- **[Guía para desarrolladores](../../DEV.md)**: compilar desde el código, arquitectura, lanzamientos.
- **¿Algo va mal?** [Abre una incidencia](https://github.com/engram-app/Engram-obsidian/issues).
- **Únete a la comunidad.** Habla con usuarios y desarrolladores en [Discord](https://discord.gg/NKWcU2mm7N).
- **¿Te gusta?** Apoya el desarrollo con [GitHub Sponsors](https://github.com/sponsors/engram-app) o [Ko-fi](https://ko-fi.com/engrams_sync). Es opcional y se agradece mucho.

## Licencia

[MIT](../../LICENSE). Algunas partes derivan de trabajo de terceros con licencia MIT; consulta [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md).
