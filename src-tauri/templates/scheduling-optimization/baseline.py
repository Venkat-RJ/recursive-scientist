"""Two reference dispatching rules for single-machine scheduling."""
from fractions import Fraction
from typing import NamedTuple


class Job(NamedTuple):
    job_index: int
    processing_time: int
    tardiness_unit_time_cost: int
    due_date: int


def edd(jobs):
    return [job.job_index for job in sorted(jobs, key=lambda job: (job.due_date, job.job_index))]


def wspt(jobs):
    def priority(job):
        return Fraction(job.processing_time, job.tardiness_unit_time_cost), job.job_index

    return [job.job_index for job in sorted(jobs, key=priority)]


RULES = {"EDD": edd, "WSPT": wspt}
