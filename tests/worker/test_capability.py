from apps.worker.analyzer.capability import CapabilityEngine

def test_canonical_slug_mapping():
    assert CapabilityEngine.map_slug("web-crawling") == "web-crawling"
    assert CapabilityEngine.map_slug("web_crawling") == "web-crawling"
    assert CapabilityEngine.map_slug("headless-browser-automation") == "headless-browser-automation"
    assert CapabilityEngine.map_slug("vector-indexing") == "vector-indexing"

def test_unknown_slug_open_world():
    # Open-world: novel slugs are preserved cleanly rather than mapped to UNMAPPED
    assert CapabilityEngine.map_slug("quantum-teleportation-system") == "quantum-teleportation-system"
    assert CapabilityEngine.map_slug("sgp4_orbital_propagation") == "sgp4-orbital-propagation"
    assert CapabilityEngine.map_slug("photogrammetric-3d-reconstruction") == "photogrammetric-3d-reconstruction"
