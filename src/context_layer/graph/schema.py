"""The knowledge-graph ontology: node kinds and edge types.

One graph holds Elisa's layers side by side (see docs/knowledge-graph.md):

    network layer   Element -LOCATED_AT-> Site, Element -MEMBER_OF-> Class
    context layer   Assertion -APPLIES_TO / OBSERVED_ON / TRIGGER-> Element | Class | Site | Event
    lifecycle       Assertion -CLOSED_BY-> Assertion, Assertion -CONFLICTS_WITH-> Assertion
    provenance      Assertion -DERIVED_FROM-> Message -PART_OF-> Thread
                    Person -AUTHORED-> Message, Assertion -STATED_BY-> Person
                    Message -MENTIONS-> Element | Site   (episodic link, from the raw text)

Node ids are stable strings so the graph can be rebuilt at any time from the store and the threads.
"""

import re

# Node kinds (Neo4j labels)
ELEMENT = "Element"
SITE = "Site"
CLASS = "Class"
EVENT = "Event"
ASSERTION = "Assertion"
PERSON = "Person"
MESSAGE = "Message"
THREAD = "Thread"

NODE_KINDS = (ELEMENT, SITE, CLASS, EVENT, ASSERTION, PERSON, MESSAGE, THREAD)

# Edge types (Neo4j relationship types)
LOCATED_AT = "LOCATED_AT"
MEMBER_OF = "MEMBER_OF"
APPLIES_TO = "APPLIES_TO"
OBSERVED_ON = "OBSERVED_ON"
TRIGGER = "TRIGGER"
CLOSED_BY = "CLOSED_BY"
CONFLICTS_WITH = "CONFLICTS_WITH"
DERIVED_FROM = "DERIVED_FROM"
STATED_BY = "STATED_BY"
AUTHORED = "AUTHORED"
PART_OF = "PART_OF"
MENTIONS = "MENTIONS"

# Binding role in models.Binding -> edge type
BINDING_EDGE = {"applies_to": APPLIES_TO, "observed_on": OBSERVED_ON, "trigger": TRIGGER}


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def person_id(name: str) -> str:
    return f"person:{_slug(name)}"


def thread_id(tid: str) -> str:
    return f"thread:{tid}"


def message_id(tid: str, seq: int) -> str:
    return f"msg:{tid}#{seq}"
