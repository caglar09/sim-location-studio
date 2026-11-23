#!/usr/bin/env python3
"""Read VIA Rail's official GTFS feed and return the next train in either direction."""
import csv
import datetime as dt
import io
import json
import math
import sys
import zipfile


def rows(archive, filename):
    with archive.open(filename) as data:
        yield from csv.DictReader(io.TextIOWrapper(data, encoding='utf-8-sig'))


def distance(a, b):
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


def main():
    _, filename, service_date, earliest, from_text, to_text = sys.argv
    source = tuple(map(float, from_text.split(',')))
    target = tuple(map(float, to_text.split(',')))
    with zipfile.ZipFile(filename) as archive:
        stations = {row['stop_id']: row for row in rows(archive, 'stops.txt')}
        start = min(stations.values(), key=lambda row: distance(source, (float(row['stop_lat']), float(row['stop_lon']))))
        end = min(stations.values(), key=lambda row: distance(target, (float(row['stop_lat']), float(row['stop_lon']))))
        calendar = {row['service_id']: row for row in rows(archive, 'calendar.txt')}
        trips = {row['trip_id']: row for row in rows(archive, 'trips.txt') if row['route_id'] == '226-119'}
        by_trip = {}
        for row in rows(archive, 'stop_times.txt'):
            if row['trip_id'] in trips:
                by_trip.setdefault(row['trip_id'], []).append(row)

        requested = dt.datetime.strptime(service_date, '%Y-%m-%d').date() if service_date else dt.date.today()
        requested_key = requested.strftime('%Y%m%d')
        weekday = ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')[requested.weekday()]
        earliest_seconds = sum(int(part) * factor for part, factor in zip(earliest.split(':') if earliest else ['00', '00'], (3600, 60)))
        options = []
        for trip_id, stops in by_trip.items():
            schedule = calendar.get(trips[trip_id]['service_id'])
            if not schedule or not (schedule['start_date'] <= requested_key <= schedule['end_date']) or schedule[weekday] != '1':
                continue
            stops.sort(key=lambda stop: int(stop['stop_sequence']))
            start_index = next((i for i, row in enumerate(stops) if row['stop_id'] == start['stop_id']), None)
            end_index = next((i for i, row in enumerate(stops) if row['stop_id'] == end['stop_id']), None)
            if start_index is None or end_index is None or start_index >= end_index:
                continue
            departure = stops[start_index]['departure_time']
            depart_seconds = sum(int(part) * factor for part, factor in zip(departure.split(':'), (3600, 60, 1)))
            if depart_seconds < earliest_seconds:
                continue
            options.append((depart_seconds, trips[trip_id], stops[start_index], stops[end_index]))
        if not options:
            raise RuntimeError(f"Aucun train VIA Rail de {start['stop_name']} à {end['stop_name']} trouvé le {requested.isoformat()} après {earliest or '00:00'}.")
        depart_seconds, trip, start_time, end_time = min(options, key=lambda item: item[0])
        shapes = []
        for row in rows(archive, 'shapes.txt'):
            if row['shape_id'] == trip['shape_id']:
                travelled = float(row.get('shape_dist_traveled') or 0)
                low = float(start_time.get('shape_dist_traveled') or 0)
                high = float(end_time.get('shape_dist_traveled') or 1e20)
                if low - 2000 <= travelled <= high + 2000:
                    shapes.append((travelled, {'lat': float(row['shape_pt_lat']), 'lng': float(row['shape_pt_lon'])}))
        shapes.sort(key=lambda item: item[0])
        if len(shapes) < 2:
            raise RuntimeError('Le GTFS VIA Rail ne contient pas la géométrie ferroviaire du train choisi.')
        departure_time = start_time['departure_time']
        arrival_time = end_time['arrival_time']
        def clock(value):
            hour, minute, _ = map(int, value.split(':'))
            return f'{hour % 24:02d}:{minute:02d}'
        first = (float(start['stop_lat']), float(start['stop_lon']))
        last = (float(end['stop_lat']), float(end['stop_lon']))
        distance_meters = float(end_time.get('shape_dist_traveled') or 0) - float(start_time.get('shape_dist_traveled') or 0)
        print(json.dumps({
            'date': requested.isoformat(), 'departureTime': clock(departure_time), 'arrivalTime': clock(arrival_time),
            'trainNumber': trip['trip_short_name'], 'distanceMeters': max(0, distance_meters),
            'points': [point for _, point in shapes],
            'startStation': start['stop_name'], 'endStation': end['stop_name'],
            'warning': None
        }))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
