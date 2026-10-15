import sys
from pathlib import Path
import unittest
if sys.platform != 'linux':
    raise unittest.SkipTest('Linux raw-input helper; other platforms use native Pointer Events')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'electron'))
from direct_touch import Contacts,PenContact,PenButtons,EV_KEY,EV_ABS,EV_SYN,SYN_REPORT,SYN_DROPPED,SLOT,X,Y,TRACKING_ID,BTN_TOUCH,BTN_TOOL_PEN,BTN_TOOL_RUBBER,BTN_STYLUS,BTN_STYLUS2

class DirectTouchTests(unittest.TestCase):
    def test_upper_button_virtual_eraser_and_real_button_share_lasso_state(self):
        buttons=PenButtons()
        self.assertEqual(buttons.feed(EV_SYN,SYN_REPORT,0),{'type':'pen-buttons','primary':False,'secondary':False})
        buttons.feed(EV_KEY,BTN_TOOL_RUBBER,1)
        self.assertEqual(buttons.feed(EV_SYN,SYN_REPORT,0),{'type':'pen-buttons','primary':False,'secondary':True})
        buttons.feed(EV_KEY,BTN_TOUCH,0)
        self.assertIsNone(buttons.feed(EV_SYN,SYN_REPORT,0),'Tip lift must not release a held upper button')
        buttons.feed(EV_KEY,BTN_STYLUS2,1);buttons.feed(EV_KEY,BTN_TOOL_RUBBER,0)
        self.assertIsNone(buttons.feed(EV_SYN,SYN_REPORT,0),'Tool flip must be frame-coherent')
        buttons.feed(EV_KEY,BTN_STYLUS,1);buttons.feed(EV_KEY,BTN_STYLUS2,0)
        self.assertEqual(buttons.feed(EV_SYN,SYN_REPORT,0),{'type':'pen-buttons','primary':True,'secondary':False})
    def test_tip_lift_is_immediate_even_while_tool_remains_in_proximity(self):
        pen=PenContact()
        pen.feed(EV_KEY,BTN_TOOL_PEN,1)
        self.assertEqual(pen.feed(EV_SYN,SYN_REPORT,0),{'type':'pen-contact','contact':False,'proximity':True})
        pen.feed(EV_KEY,BTN_TOUCH,1)
        self.assertTrue(pen.feed(EV_SYN,SYN_REPORT,0)['contact'])
        pen.feed(EV_KEY,BTN_TOUCH,0)
        self.assertEqual(pen.feed(EV_SYN,SYN_REPORT,0),{'type':'pen-contact','contact':False,'proximity':True})
        self.assertIsNone(pen.feed(EV_SYN,SYN_REPORT,0))
        pen.feed(EV_KEY,BTN_TOOL_PEN,0)
        self.assertFalse(pen.feed(EV_SYN,SYN_REPORT,0)['proximity'])
    def test_eraser_proximity_does_not_count_as_tip_contact(self):
        pen=PenContact();pen.feed(EV_KEY,BTN_TOOL_RUBBER,1)
        self.assertEqual(pen.feed(EV_SYN,SYN_REPORT,0),{'type':'pen-contact','contact':False,'proximity':True})
    def test_multitouch_frames_release_and_coordinate_ranges(self):
        c=Contacts(100,1100,200,2200)
        def abs_(code,value):self.assertEqual(c.feed(EV_ABS,code,value),[])
        def frame():return c.feed(EV_SYN,SYN_REPORT,0)
        abs_(TRACKING_ID,41);abs_(X,350);abs_(Y,1200)
        self.assertEqual(frame(),[{'id':41,'phase':'down','x':.25,'y':.5}])
        abs_(SLOT,1);abs_(TRACKING_ID,42);abs_(X,850);abs_(Y,1200)
        self.assertEqual(frame(),[{'id':42,'phase':'down','x':.75,'y':.5}])
        abs_(X,1050)
        self.assertEqual(frame(),[{'id':42,'phase':'move','x':.95,'y':.5}])
        abs_(TRACKING_ID,-1)
        self.assertEqual(frame(),[{'id':42,'phase':'up','x':.95,'y':.5}])
        self.assertEqual(frame(),[])
    def test_dropped_frames_cancel_contacts_and_never_create_phantom_touches(self):
        c=Contacts(0,1000,0,1000)
        for code,value in [(TRACKING_ID,1),(X,300),(Y,400)]:c.feed(EV_ABS,code,value)
        c.feed(EV_SYN,SYN_REPORT,0)
        self.assertEqual(c.feed(EV_SYN,SYN_DROPPED,0),[{'id':1,'phase':'cancel','x':.3,'y':.4}])
        c.feed(EV_ABS,TRACKING_ID,5);c.feed(EV_ABS,X,900);c.feed(EV_SYN,SYN_REPORT,0)
        self.assertEqual(c.feed(EV_SYN,SYN_REPORT,0),[])
        for code,value in [(TRACKING_ID,6),(X,200),(Y,300)]:c.feed(EV_ABS,code,value)
        self.assertEqual(c.feed(EV_SYN,SYN_REPORT,0),[{'id':6,'phase':'down','x':.2,'y':.3}])
    def test_one_frame_can_replace_a_contact_without_reusing_its_identity(self):
        c=Contacts(0,1000,0,1000)
        for code,value in [(TRACKING_ID,1),(X,300),(Y,400)]:c.feed(EV_ABS,code,value)
        c.feed(EV_SYN,SYN_REPORT,0)
        c.feed(EV_ABS,TRACKING_ID,-1);c.feed(EV_ABS,TRACKING_ID,2)
        self.assertEqual([e['phase'] for e in c.feed(EV_SYN,SYN_REPORT,0)],['up','down'])
