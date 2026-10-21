def pytest_configure(config):
    config.addinivalue_line("markers", "docker: runs a real container through the local docker daemon (skipped when docker is unavailable)")
