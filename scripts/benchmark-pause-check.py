"""Verify a staged Benchmark pause patch with loopback HTTP and fake workers only."""
import importlib
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
from concurrent.futures import Future
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.dont_write_bytecode = True


def check(root):
    with tempfile.TemporaryDirectory(prefix="benchmark-pause-check-") as temporary:
        env = {
            "SPENDLOGS_JSONL": str(Path(temporary)/"unused.jsonl"), "SPENDLOGS_MANIFEST": "",
            "POSTGRES_HOST": "unused", "POSTGRES_PORT": "5432", "POSTGRES_DB": "unused",
            "POSTGRES_USER": "unused", "POSTGRES_PASSWORD": "", "POSTGRES_DSN": "",
            "LITELLM_URL": "http://unused.invalid", "LITELLM_MASTER_KEY": "test-only",
            "BENCHMARK_API_KEY": "test-only", "BENCHMARK_STATE_DB": str(Path(temporary)/"state.sqlite"),
            "BENCHMARK_PORT": "0", "BENCHMARK_HOST": "127.0.0.1",
            "BENCHMARK_RESPONSE_READ_TIMEOUT": "1",
            "BENCHMARK_MAX_WORKERS": "2", "BENCHMARK_MODEL_METRICS_MAP": '{}',
        }
        with patch.dict(os.environ, env):
            sys.path.insert(0, str(root.resolve()))
            api = importlib.import_module("app.benchmark.api")
            core = importlib.import_module("app.benchmark.core")
            server = ThreadingHTTPServer(("127.0.0.1", 0), api.Handler)
            http_thread = threading.Thread(target=server.serve_forever, daemon=True)
            http_thread.start()
            origin = f"http://127.0.0.1:{server.server_port}"
            workers = []
            submissions = []
            submitted = threading.Condition()

            def call(path, method="GET", body=None, key=None, auth=True):
                headers = {"Authorization": "Bearer test-only"} if auth else {}
                if key: headers["Idempotency-Key"] = key
                request = Request(origin+path, method=method, headers=headers,
                                  data=json.dumps(body).encode() if body is not None else None)
                try:
                    with urlopen(request, timeout=5) as response:
                        return response.status, json.load(response)
                except HTTPError as response:
                    return response.code, json.load(response)

            class Executor:
                def __init__(self, **kwargs): pass
                def submit(self, fn, *args):
                    future = Future()
                    with submitted:
                        submissions.append((time.monotonic(), args, future))
                        submitted.notify_all()
                    return future
                def shutdown(self, **kwargs): pass

            def wait_submitted(count):
                with submitted:
                    assert submitted.wait_for(lambda: len(submissions) >= count, 5), "scheduler stalled"

            def complete(task_id, index):
                result = {"status_code": 200}
                core.append_result(task_id, result)
                submissions[index][2].set_result(result)

            def create(key, gap=.45, count=3):
                with patch.object(api, "prepare_and_run", lambda *args: None):
                    status, task = call("/api/replays", "POST", {"model_id":"alias", "start_time":100,
                                                                "end_time":200, "speed":1}, key)
                assert status == 202
                task_id = task["replay_id"]
                core.update_job(task_id, status="queued", request_count=count)
                now = datetime.now(timezone.utc)
                records = [({"_timestamp":now+timedelta(seconds=i*gap), "request_id":str(i)}, {},
                            "/v1/chat/completions") for i in range(count)]
                worker = threading.Thread(target=core.run_replay, args=(task_id,"alias",records,1), daemon=True)
                workers.append(worker)
                return task_id, worker

            try:
                with patch.object(core, "ThreadPoolExecutor", Executor):
                    task_id, worker = create("paused-queued")
                    path = f"/api/replays/{task_id}"
                    status, paused = call(path+"/pause", "POST")
                    assert status == 200 and paused["status"] == "paused" and paused["resumable"]
                    assert not paused["pausable"] and "results" not in paused
                    assert call(path+"/pause", "POST")[1]["paused_at"] == paused["paused_at"]
                    worker.start()
                    time.sleep(.15)
                    assert not submissions, "queued pause must prevent the first submission"
                    assert call("/api/replays/active?view=status")[1]["task"]["status"] == "paused"
                    assert call("/api/replays", "POST", {"model_id":"alias","start_time":100,"end_time":200}, "blocked")[0] == 409
                    assert call(path+"/resume", "POST")[0] == 200
                    wait_submitted(1)
                    time.sleep(.08)
                    before_pause = time.monotonic()
                    status, paused = call(path+"/pause", "POST")
                    assert status == 200 and paused["status"] == "paused"
                    complete(task_id, 0)
                    status, progress = call(path+"?view=status")
                    assert progress["completed_count"] == 1 and progress["sent_count"] == 1
                    assert progress["status"] == "paused" and progress["cancellable"]
                    core.update_job(task_id, status="running")
                    assert core.jobs[task_id]["status"] == "paused", "worker update must not undo pause"
                    time.sleep(.55)
                    assert len(submissions) == 1, "pause must stop new submissions while in-flight work completes"
                    resumed_at = time.monotonic()
                    status, resumed = call(path+"/resume", "POST")
                    assert status == 200 and resumed["paused_at"] is None and resumed["paused_seconds"] >= .65
                    revision = resumed["revision"]
                    assert call(path+"/resume", "POST")[1]["revision"] == revision, "resume retry must be harmless"
                    wait_submitted(2)
                    remaining = .45 - (before_pause-submissions[0][0])
                    assert submissions[1][0]-resumed_at >= remaining-.09, "resume caused a catch-up burst"
                    wait_submitted(3)
                    assert submissions[2][0]-submissions[1][0] >= .30, "original intervals were lost"
                    assert abs(submissions[0][1][-1].timestamp()-core.jobs[task_id]["started_at"]) < .03
                    status, draining = call(path+"/pause", "POST")
                    assert status == 409 and draining["task"]["status"] == "draining"
                    complete(task_id, 1); complete(task_id, 2)
                    worker.join(5)
                    assert not worker.is_alive() and core.jobs[task_id]["status"] == "succeeded"

                    submissions.clear()
                    task_id, worker = create("cancel-paused", gap=100, count=2)
                    path = f"/api/replays/{task_id}"
                    worker.start(); wait_submitted(1)
                    assert call(path+"/pause", "POST")[0] == 200
                    status, cancelled = call(path+"/cancel", "POST")
                    assert status == 202 and cancelled["status"] == "cancelling"
                    assert call(path+"/resume", "POST")[0] == 409
                    deadline = time.monotonic()+3
                    while not core.jobs[task_id].get("dispatch_finished") and time.monotonic() < deadline:
                        time.sleep(.01)
                    assert core.jobs[task_id]["dispatch_finished"], "cancel did not wake the paused scheduler"
                    assert len(submissions) == 1 and core.jobs[task_id]["status"] == "cancelling"
                    assert call(path+"/cancel", "POST")[0] == 202
                    complete(task_id, 0)
                    worker.join(5)
                    assert not worker.is_alive() and core.jobs[task_id]["status"] == "cancelled"
                    assert core.jobs[task_id]["sent_count"] == 1
                    assert call(path+"/pause", "POST")[0] == 409
                    assert call(path+"/cancel", "POST")[0] == 409
                    assert call("/api/replays/unknown/pause", "POST")[0] == 404
                    assert call(path+"/pause", "POST", auth=False)[0] == 401

                    task_id, _ = create("restart-paused")
                    assert call(f"/api/replays/{task_id}/pause", "POST")[0] == 200
                    core.initialize_state_db()
                    assert core.jobs[task_id]["status"] == "failed", "backend restart cannot resume runtime workers"
                print("PASS: queued/running pause, in-flight progress, active recovery, duplicate controls, remaining intervals, draining conflict, paused cancel, auth and restart")
            finally:
                with core.replay_condition:
                    for event in core.cancel_events.values(): event.set()
                    core.replay_condition.notify_all()
                for _, _, future in submissions:
                    if not future.done(): future.set_result({"status_code":200})
                for worker in workers:
                    if worker.ident is not None: worker.join(5)
                server.shutdown(); server.server_close(); http_thread.join(5)


if __name__ == "__main__":
    check(Path(sys.argv[1]))
