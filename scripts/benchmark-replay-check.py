"""Exercise staged/installed Benchmark against loopback only; never send inference."""
import importlib
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
from concurrent.futures import Future
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
sys.dont_write_bytecode = True


def check(root):
    with tempfile.TemporaryDirectory(prefix="benchmark-check-") as temporary:
        env = {
            "SPENDLOGS_JSONL": str(Path(temporary)/"unused.jsonl"), "SPENDLOGS_MANIFEST": "",
            "POSTGRES_HOST": "unused", "POSTGRES_PORT": "5432", "POSTGRES_DB": "unused",
            "POSTGRES_USER": "unused", "POSTGRES_PASSWORD": "", "POSTGRES_DSN": "",
            "LITELLM_URL": "http://unused.invalid", "LITELLM_MASTER_KEY": "test-only",
            "BENCHMARK_API_KEY": "test-only", "BENCHMARK_PORT": "0", "BENCHMARK_HOST": "127.0.0.1",
            "BENCHMARK_MAX_WORKERS": "2", "BENCHMARK_RESPONSE_READ_TIMEOUT": "1",
            "BENCHMARK_STATE_DB": str(Path(temporary)/"state.sqlite"),
            "BENCHMARK_MODEL_METRICS_MAP": '{"alias":"real-model"}',
        }
        with patch.dict(os.environ, env):
            sys.path.insert(0, str(root))
            api = importlib.import_module("app.benchmark.api")
            core = importlib.import_module("app.benchmark.core")
            server = ThreadingHTTPServer(("127.0.0.1", 0), api.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            origin = f"http://127.0.0.1:{server.server_port}"

            def call(path, body=None, key=None):
                headers = {"Authorization": "Bearer test-only"}
                if key: headers["Idempotency-Key"] = key
                data = json.dumps(body).encode() if body is not None else None
                request = Request(origin+path, data=data, headers=headers)
                try:
                    with urlopen(request, timeout=5) as response:
                        return response.status, json.load(response)
                except HTTPError as response:
                    return response.code, json.load(response)

            try:
                with patch.object(api, "prepare_and_run", lambda *args: None):
                    body = {"model_id":"alias", "start_time":100, "end_time":200, "speed":5}
                    status, created = call("/api/replays", body, "same-operation")
                    assert status == 202 and created["speed"] == 5
                    task_id = created["replay_id"]
                    status, duplicate = call("/api/replays", body, "same-operation")
                    assert status == 200 and duplicate["replay_id"] == task_id
                    assert call("/api/replays", {**body,"speed":2}, "same-operation")[0] == 409
                    assert call("/api/replays", body, "another-operation")[1]["active_task"]["speed"] == 5
                job = core.jobs[task_id]
                job["results"] = [{"output":"large test result"}]*1000
                _, active = call("/api/replays/active?view=status")
                assert active["task"]["target"]["metrics_labels"]["model_name"] == "real-model"
                assert "results" not in active["task"] and active["task"]["speed"] == 5
                assert "results" not in call(f"/api/replays/{task_id}?view=status")[1]
                assert len(call(f"/api/replays/{task_id}")[1]["results"]) == 1000
                status, cancelled = call(f"/api/replays/{task_id}/cancel", {})
                assert status == 202 and cancelled["status"] == "cancelling"
                revision = cancelled["revision"]
                assert call(f"/api/replays/{task_id}/cancel", {})[0] == 202
                core.update_job(task_id, status="running", completed_count=1)
                assert job["status"] == "cancelling" and job["revision"] > revision
                core.update_job(task_id, status="succeeded", finished_at=300)
                assert job["status"] == "cancelled"
                core.update_job(task_id, status="running")
                assert job["status"] == "cancelled"
                status, ended = call(f"/api/replays/{task_id}/cancel", {})
                assert status == 409 and ended["task"]["status"] == "cancelled"

                # Deterministic cancellation during the gap after the first submission.
                second = {**job,"run_id":"race","status":"queued","results":[],"sent_count":0,"completed_count":0}
                core.register_job(second,"race-key","race-fingerprint")
                event = threading.Event(); core.cancel_events["race"] = event
                submitted = threading.Event(); submissions = []
                class Executor:
                    def __init__(self, **kwargs): pass
                    def submit(self, fn, *args):
                        submissions.append(args)
                        submitted.set()
                        future = Future(); future.set_result({"status_code":200}); return future
                    def shutdown(self, **kwargs): pass
                def accept_cancel():
                    assert submitted.wait(5)
                    with core.jobs_lock:
                        second["status"] = "cancelling"; core.save_job(second); event.set()
                cancel_thread = threading.Thread(target=accept_cancel)
                cancel_thread.start()
                now = datetime.now(timezone.utc)
                records = [({"_timestamp":now+timedelta(seconds=i),"request_id":str(i)}, {}, "/v1/chat/completions") for i in range(3)]
                with patch.object(core,"ThreadPoolExecutor",Executor): core.run_replay("race","alias",records,1)
                cancel_thread.join(5)
                assert len(submissions) == 1 and second["sent_count"] == 1 and second["status"] == "cancelled"
                restarted = {**second,"run_id":"restart","status":"running"}
                core.register_job(restarted,"restart-key","restart-fingerprint")
                revision = restarted["revision"]
                core.initialize_state_db()
                assert core.jobs["restart"]["status"] == "failed"
                assert core.jobs["restart"]["revision"] == revision + 1
                assert "not resumed" in core.jobs["restart"]["error"]
                print("PASS: speed/revision, real metric labels, lightweight status, idempotency, conflicts, cancellation, atomic submission and restart failure")
            finally:
                server.shutdown(); server.server_close(); thread.join(5)


if __name__ == "__main__":
    check(Path(sys.argv[1]))
