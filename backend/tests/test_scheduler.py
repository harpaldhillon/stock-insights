from types import SimpleNamespace

from scheduler import init_scheduler


def test_init_scheduler_registers_daily_refresh_job():
    app = SimpleNamespace(state=SimpleNamespace())
    calls = []

    def refresh():
        calls.append(1)

    init_scheduler(app, refresh)
    try:
        assert app.state.scheduler.running
        job = app.state.scheduler.get_job("daily_refresh")
        assert job is not None
        trigger_str = str(job.trigger)
        assert "hour='18'" in trigger_str
        assert "minute='30'" in trigger_str
    finally:
        app.state.scheduler.shutdown(wait=False)
