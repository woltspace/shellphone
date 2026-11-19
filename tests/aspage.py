"""For the tests that stand in for a browser: a POST from the room's own page says where it comes from (Origin), as
browsers do. The room takes a POST from nowhere else (room.py not_ours)."""
import urllib.request


class AsPage(urllib.request.BaseHandler):
    handler_order = 100

    def http_request(self, req):
        if req.data is not None and not req.has_header("Origin") and not req.has_header("Authorization"):  # an agent's call carries its own key, and no Origin
            req.add_unredirected_header("Origin", f"{req.type}://{req.host}")
        return req


def as_page(*handlers):
    """An opener that posts as the page at the address it posts to."""
    return urllib.request.build_opener(AsPage, *handlers)
