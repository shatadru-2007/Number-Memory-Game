import asyncio
from aiohttp.test_utils import AioHTTPTestCase
import unittest
import server

class ServerTestCase(AioHTTPTestCase):
    async def get_application(self):
        return server.create_app()

    async def test_get_config(self):
        resp = await self.client.get('/api/config')
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertIn('stages', data)
        self.assertIn('stage1', data['stages'])

    async def test_index_page(self):
        resp = await self.client.get('/')
        self.assertEqual(resp.status, 200)
        text = await resp.text()
        self.assertIn('OpenCV Memory Game', text)

    async def test_admin_flow(self):
        # Admin login
        resp = await self.client.post('/api/admin/login', json={'password': 'admin2026'})
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        token = data.get('token')
        self.assertEqual(token, 'admin_session_aarohan_2026')

        # Audience live stats
        live_resp = await self.client.get('/api/audience/live')
        self.assertEqual(live_resp.status, 200)
        live_data = await live_resp.json()
        self.assertIn('stats', live_data)
        self.assertIn('leaderboard', live_data)

    async def test_websocket_connect(self):
        ws = await self.client.ws_connect('/')
        msg = await ws.receive_json()
        self.assertEqual(msg.get('type'), 'INIT_STATE')
        self.assertIn('payload', msg)
        await ws.close()

    async def test_participant_tournament_flow(self):
        # 1. Create team
        res = await self.client.post('/api/participant/create-team', json={
            'teamName': 'CyberHawks',
            'leaderName': 'Alice Roy',
            'rollNumber': 'TEST-ROLL-001',
            'email': 'alice@college.edu',
            'college': 'AAROHAN Tech'
        })
        self.assertEqual(res.status, 200)
        c_data = await res.json()
        self.assertTrue(c_data['success'])
        team_code = c_data['team']['code']
        self.assertTrue(team_code.startswith('MEM-'))

        # 2. Duplicate roll number should be rejected
        dup_res = await self.client.post('/api/participant/create-team', json={
            'teamName': 'AnotherTeam',
            'leaderName': 'Alice Roy Duplicate',
            'rollNumber': 'TEST-ROLL-001',
            'email': 'alice2@college.edu'
        })
        self.assertEqual(dup_res.status, 400)
        dup_data = await dup_res.json()
        self.assertIn('Duplicate registration is not permitted', dup_data['error'])

        # 3. Teammate join
        join_res = await self.client.post('/api/participant/join-team', json={
            'teamCode': team_code,
            'memberName': 'Bob Smith',
            'rollNumber': 'TEST-ROLL-002',
            'email': 'bob@college.edu',
            'college': 'AAROHAN Tech'
        })
        self.assertEqual(join_res.status, 200)
        j_data = await join_res.json()
        self.assertTrue(j_data['success'])

        # 4. Submit Stage 1 score for leader
        s1_res = await self.client.post('/api/game/submit-stage', json={
            'rollNumber': 'TEST-ROLL-001',
            'teamCode': team_code,
            'stageNumber': 1,
            'sequenceShown': [1, 2, 3, 4, 5],
            'sequenceEntered': [1, 2, 3, 4, 5],
            'score': 5
        })
        self.assertEqual(s1_res.status, 200)
        s1_data = await s1_res.json()
        self.assertEqual(s1_data['participant']['scores']['stage1'], 5)

        # 5. Export CSV
        csv_res = await self.client.get('/api/admin/export-csv?token=admin_session_aarohan_2026')
        self.assertEqual(csv_res.status, 200)
        csv_text = await csv_res.text()
        self.assertIn('CyberHawks', csv_text)
        self.assertIn('TEST-ROLL-001', csv_text)

        # 6. Admin Delete Team (cleanup)
        del_res = await self.client.post('/api/admin/delete-team', json={
            'token': 'admin_session_aarohan_2026',
            'teamCode': team_code
        })
        self.assertEqual(del_res.status, 200)

if __name__ == '__main__':
    unittest.main()
