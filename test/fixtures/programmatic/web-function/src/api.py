import json


async def application(scope, receive, send):
    await send({
        'type': 'http.response.start',
        'status': 200,
        'headers': [(b'content-type', b'application/json')],
    })
    await send({'type': 'http.response.body', 'body': json.dumps({'message': 'Api'}).encode()})
