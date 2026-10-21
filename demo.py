"""Start a separate synthetic demo. Never touches desktop or production records."""
from datetime import date, timedelta
from pathlib import Path
from server import Database, empty_state, make_server, today


def main():
    db=Database(Path(__file__).parent/'data'/'demo.sqlite3')
    with db.connect() as conn:
        exists=conn.execute('SELECT count(*) FROM users').fetchone()[0]
    if not exists:
        db.bootstrap('demo','DemoOnlyPassword123!')
        user=db.login('demo','DemoOnlyPassword123!','demo')['user']
        state=empty_state()
        state['groups']=['Група 1','Група 2','Група 3']
        names=['Коваленко Андрій','Бондар Ігор','Мельник Сергій','Шевченко Артем','Петренко Олег','Савченко Роман','Мороз Владислав','Ткаченко Богдан','Лисенко Віталій','Олійник Михайло']
        calls=['Кедр','Клен','Риф','Дуб','Маяк','Бук','Атлас','Компас','Промінь','Берег']
        anchor=date.fromisoformat(today()).replace(day=1)
        for i,name in enumerate(names):
            pid='demo-'+str(i)
            state['people'].append(dict(id=pid,name='ДЕМО · '+name,callsign=calls[i],rank='Солдат',role=state['roles'][i%5],unit='Тестовий підрозділ',phone='',group=state['groups'][i%3],service_since='2024-01-15',notes='Вигадана картка для тестування.',archived=False))
            periods=[(0,5,'Робота'),(10,13,'Відпустка' if i%3==0 else 'Робота'),(19,23,'ВЛК' if i==5 else 'Лікарняний' if i==7 else 'Робота')]
            for n,(start,end,kind) in enumerate(periods):
                state['events'].append(dict(id=f'demo-{i}-{n}',person_id=pid,kind=kind,start=(anchor+timedelta(days=start)).isoformat(),end=(anchor+timedelta(days=end)).isoformat(),notes='Тестовий кадровий період',returned_on='',cancelled=False))
        db.commit(user,state,0,'Створено окремі вигадані демодані')
    server=make_server(db,port=8766)
    print('Demo: http://127.0.0.1:8766 · login demo · password DemoOnlyPassword123!',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()


if __name__=='__main__':main()
