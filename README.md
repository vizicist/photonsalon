# Photon Salon

Remote controller for a Palette engine.

## Run

Start a Palette engine, then run:

```sh
npm start
```

The remote opens at:

```text
http://127.0.0.1:8080/
```

By default the proxy expects the Palette engine at `http://127.0.0.1:3330`.
Use `PALETTE_ENGINE_URL` to point at a different engine:

```sh
PALETTE_ENGINE_URL=http://192.168.1.50:3330 npm start
```

To target a remote Palette host through the engine's NATS proxy, pass the host
name in the URL:

```text
http://127.0.0.1:8080/?host=some-palette-host
```
