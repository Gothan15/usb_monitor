# Requires: pip install requests
import threading
import time
import uuid
import requests

BASE_URL = "http://localhost:3000"
API_KEY = "uk_70NlAI4TlAkoIo1d2qGkcST2877vLPIl"

# Enterprise-like profile: warm-up ramp, then sustained load
MAX_CONCURRENCY = 50
WARMUP_SECONDS = 30
TEST_DURATION_SECONDS = 120
MIN_RPS_PER_THREAD = 2.0
MAX_RPS_PER_THREAD = 5.0

headers = {"Authorization": f"ApiKey {API_KEY}"}


def worker(stop_at: float) -> None:
    session = requests.Session()
    url = f"{BASE_URL}/api/whitelist/check"
    while time.time() < stop_at:
        try:
            params = {"serial": generate_serial()}
            session.get(url, params=params, headers=headers, timeout=3)
        except Exception:
            pass
        # Rate limit per thread with jitter for realism
        target_rps = MIN_RPS_PER_THREAD + (
            (MAX_RPS_PER_THREAD - MIN_RPS_PER_THREAD) * (uuid.uuid4().int % 1000) / 1000.0
        )
        sleep_s = 1.0 / max(target_rps, 0.1)
        time.sleep(sleep_s)


def generate_serial() -> str:
    return f"USB{int(time.time() * 1000)}_{uuid.uuid4().hex[:12]}".upper()


def main() -> None:
    print("Starting test...")
    threads = []
    stop_at = time.time() + TEST_DURATION_SECONDS

    # Warm-up ramp
    for i in range(MAX_CONCURRENCY):
        t = threading.Thread(target=worker, args=(stop_at,))
        t.start()
        threads.append(t)
        if WARMUP_SECONDS > 0:
            time.sleep(WARMUP_SECONDS / MAX_CONCURRENCY)

    for t in threads:
        t.join()
    print("Test finished")


if __name__ == "__main__":
    main()