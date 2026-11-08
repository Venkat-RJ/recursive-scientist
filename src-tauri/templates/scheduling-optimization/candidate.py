"""Edit solve() to try a scheduling hypothesis."""


def solve(jobs):
    """Return each original job_index once, in processing order.

    jobs is a tuple of immutable records with job_index, processing_time,
    tardiness_unit_time_cost and due_date fields.
    """
    return [job.job_index for job in sorted(jobs, key=lambda job: (job.due_date, job.job_index))]
