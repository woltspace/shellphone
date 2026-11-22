"""Stands in for Cloudflare on the own-domain path: TLS on 443, then the tunnel's real door (shellphone/door.py)."""
import contextlib, socket, ssl, sys, threading

from shellphone import home
from shellphone.door import Door

name, port, path = sys.argv[1], int(sys.argv[2]), "/tmp/door.sock"
door = Door(path, lambda: {name: {"port": port, "keep": None}}, home.answers_as_room)
tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
tls.load_cert_chain("/cert/room.crt", "/cert/room.key")


def serve(raw):
    with contextlib.suppress(OSError):
        with tls.wrap_socket(raw, server_side=True) as person, socket.socket(socket.AF_UNIX) as up:
            up.connect(path)

            def onward():
                with contextlib.suppress(OSError):
                    while data := person.recv(65536):
                        up.sendall(data)

            threading.Thread(target=onward, daemon=True).start()
            while data := up.recv(65536):
                person.sendall(data)


listen = socket.create_server(("0.0.0.0", 443), backlog=64)
while True:
    threading.Thread(target=serve, args=(listen.accept()[0],), daemon=True).start()
