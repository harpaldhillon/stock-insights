import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)


def init_scheduler(app, refresh_callable):
    scheduler = BackgroundScheduler(timezone="Europe/London")
    scheduler.add_job(
        refresh_callable,
        trigger=CronTrigger(hour=18, minute=30),
        id="daily_refresh",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.start()
    app.state.scheduler = scheduler
    logger.info("Scheduler started: daily refresh at 18:30 UK time")
