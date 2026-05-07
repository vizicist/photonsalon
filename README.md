# Photon Salon

Remote controller for a Palette engine.

## Run

Start a NATS server with WebSocket support, start a Palette engine connected to
that NATS server, then run:

```sh
NATS_URL=ws://127.0.0.1:8080 npm start
```

The remote opens at:

```text
http://127.0.0.1:8080/
```

`NATS_URL` must point at a browser-reachable NATS WebSocket listener. The
`nats.ws` client accepts URLs such as `ws://...`, `wss://...`, `nats://...`, and
`tls://...`; the NATS server still needs WebSocket support enabled. The remote
sends Palette API requests directly to:

```text
to_palette.<host>.api
```

The default host is `photonsalon`. Override it with `PHOTON_SALON_HOST`:

```sh
NATS_URL=ws://127.0.0.1:8080 PHOTON_SALON_HOST=my-palette npm start
```

Or pass the host in the URL:

```text
http://127.0.0.1:8080/?host=some-palette-host
```

There is no HTTP Palette proxy in this app. The local server only serves static
files and exposes `NATS_URL` to the browser.
