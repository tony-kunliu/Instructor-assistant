"""Build the on-device ACT junction index from a Geofabrik ACT .osm.pbf (requires osmium)."""

import argparse
import collections
import json
import math
from pathlib import Path

import osmium

M_PER_DEGREE = 111_195
LON_SCALE = M_PER_DEGREE * math.cos(math.radians(-35.3))
DRIVABLE = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
    "residential", "living_street", "service", "road",
}


def distance(a, b):
    return math.hypot((a[0] - b[0]) * M_PER_DEGREE, (a[1] - b[1]) * LON_SCALE)


def make_index(source):
    signals, mini, rings = {}, {}, []
    roads = collections.defaultdict(set)
    for item in osmium.FileProcessor(source).with_locations():
        highway = item.tags.get("highway")
        if item.is_node() and highway == "traffic_signals":
            signals[item.id] = (item.location.lat, item.location.lon)
        elif item.is_node() and highway == "mini_roundabout":
            mini[item.id] = (item.location.lat, item.location.lon)
        elif item.is_way() and highway in DRIVABLE:
            name = item.tags.get("name", "")
            if item.tags.get("junction") == "roundabout":
                nodes = {node.ref: (node.lat, node.lon) for node in item.nodes if node.location.valid()}
                if len(nodes) >= 2:
                    rings.append((item.id, nodes, name))
            else:
                for node in item.nodes:
                    roads[node.ref].add(name)

    result = []
    for key, position in mini.items():
        if key in roads:
            result.append(feature("roundabout", f"n{key}", position, 12, roads[key]))
    # One physical ring can consist of several tagged OSM ways. Dissolve shared nodes before indexing.
    attached = collections.defaultdict(list)
    for index, (_, nodes, _) in enumerate(rings):
        for node in nodes:
            attached[node].append(index)
    visited = set()
    for index, (key, _, _) in enumerate(rings):
        if index in visited:
            continue
        pending = [index]
        nodes, names = {}, set()
        while pending:
            next_index = pending.pop()
            if next_index in visited:
                continue
            visited.add(next_index)
            _, part, name = rings[next_index]
            if name:
                names.add(name)
            nodes.update(part)
            for node in part:
                pending.extend(attached[node])
        points = list(nodes.values())
        center = tuple(sum(values) / len(points) for values in zip(*points))
        if len(points) < 3:
            continue
        radius = min(85, max(12, math.ceil(max(distance(center, point) for point in points))))
        names = names or set().union(*(roads.get(node, set()) for node in nodes))
        result.append(feature("roundabout", f"w{key}", center, radius, names))

    remaining = {key: coord for key, coord in signals.items() if key in roads}
    while remaining:
        key = min(remaining)
        center = remaining.pop(key)
        group = [(key, center)]
        neighbors = [candidate for candidate, coord in remaining.items() if distance(center, coord) <= 32]
        for neighbor in neighbors:
            group.append((neighbor, remaining.pop(neighbor)))
        center = tuple(sum(values) / len(group) for values in zip(*(position for _, position in group)))
        radius = max(14, math.ceil(max(distance(center, position) for _, position in group) + 10))
        result.append(feature("signal", f"n{key}", center, radius, set().union(*(roads[k] for k, _ in group))))
    return sorted(result, key=lambda entry: (entry[0], entry[1]))


def feature(kind, identifier, center, radius, names):
    return [kind, identifier, *(round(value, 6) for value in center), radius,
            " / ".join(sorted(filter(None, names))[:3])[:100]]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("version", help="Geofabrik extract date (YYYY-MM-DD)")
    args = parser.parse_args()
    data = {"source": "OpenStreetMap contributors", "licence": "ODbL-1.0", "extract": args.version,
            "junctions": make_index(args.source)}
    output = Path(__file__).resolve().parents[1] / f"public/openstreetmap/act-junctions-{args.version}.json"
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(data['junctions'])} junctions")
