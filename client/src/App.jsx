import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

const CHUNK_SIZE = 16384;
// point to your signaling server here
const SIGNALING_SERVER = 'http://localhost:8081';

//const SIGNALING_SERVER=`http://your-public-ip/signal`

export default function App() {
  const [myId, setMyId] = useState('');
  const [peers, setPeers] = useState([]);
  const [connectedPeer, setConnectedPeer] = useState(null);
  const [status, setStatus] = useState([]);
  const [progress, setProgress] = useState(0);
  const [isReceiving, setIsReceiving] = useState(false);

  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const fileInputRef = useRef(null);

  const receivedBuffersRef = useRef([]);
  const receivedSizeRef = useRef(0);
  const fileMetadataRef = useRef(null);

  useEffect(() => {
    socketRef.current = io(SIGNALING_SERVER);

    socketRef.current.on('connect', () => {
      setMyId(socketRef.current.id);
      addStatus('Connected to signaling server', 'success');
    });

    socketRef.current.on('peers', (peerList) => {
      setPeers(peerList);
    });

    socketRef.current.on('peer-joined', (peerId) => {
      setPeers(prev => [...prev, peerId]);
      addStatus(`Peer ${peerId.substring(0, 8)}... joined`, 'info');
    });

    socketRef.current.on('peer-left', (peerId) => {
      setPeers(prev => prev.filter(p => p !== peerId));
      addStatus(`Peer ${peerId.substring(0, 8)}... left`, 'info');
      if (connectedPeer === peerId) {
        closePeerConnection();
      }
    });

    socketRef.current.on('offer', handleOffer);
    socketRef.current.on('answer', handleAnswer);
    socketRef.current.on('ice-candidate', handleIceCandidate);

    return () => {
      socketRef.current?.disconnect();
      closePeerConnection();
    };
  }, []);

  const addStatus = (message, type = 'info') => {
    const newStatus = { id: Date.now(), message, type };
    setStatus(prev => [...prev, newStatus]);
    setTimeout(() => {
      setStatus(prev => prev.filter(s => s.id !== newStatus.id));
    }, 5000);
  };

  const connectToPeer = async (peerId) => {
    if (peerConnectionRef.current) {
      addStatus('Already connected to a peer', 'error');
      return;
    }

    setConnectedPeer(peerId);
    addStatus(`Connecting to ${peerId.substring(0, 8)}...`, 'info');

    peerConnectionRef.current = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    dataChannelRef.current = peerConnectionRef.current.createDataChannel('fileTransfer');
    setupDataChannel(dataChannelRef.current);

    peerConnectionRef.current.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('ice-candidate', {
          candidate: event.candidate,
          to: peerId
        });
      }
    };

    const offer = await peerConnectionRef.current.createOffer();
    await peerConnectionRef.current.setLocalDescription(offer);

    socketRef.current.emit('offer', {
      offer: offer,
      to: peerId
    });
  };

  const handleOffer = async ({ offer, from }) => {
    if (peerConnectionRef.current) {
      addStatus('Already in a connection', 'error');
      return;
    }

    setConnectedPeer(from);
    addStatus(`Receiving connection from ${from.substring(0, 8)}...`, 'info');

    peerConnectionRef.current = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    peerConnectionRef.current.ondatachannel = (event) => {
      dataChannelRef.current = event.channel;
      setupDataChannel(dataChannelRef.current);
    };

    peerConnectionRef.current.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('ice-candidate', {
          candidate: event.candidate,
          to: from
        });
      }
    };

    await peerConnectionRef.current.setRemoteDescription(offer);
    const answer = await peerConnectionRef.current.createAnswer();
    await peerConnectionRef.current.setLocalDescription(answer);

    socketRef.current.emit('answer', {
      answer: answer,
      to: from
    });
  };

  const handleAnswer = async ({ answer }) => {
    await peerConnectionRef.current.setRemoteDescription(answer);
  };

  const handleIceCandidate = async ({ candidate }) => {
    if (peerConnectionRef.current) {
      await peerConnectionRef.current.addIceCandidate(candidate);
    }
  };

  const setupDataChannel = (channel) => {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      addStatus('Connected! You can now send files.', 'success');
    };

    channel.onclose = () => {
      addStatus('Connection closed', 'info');
      closePeerConnection();
    };

    channel.onerror = (error) => {
      addStatus('Data channel error', 'error');
      console.error('Data channel error:', error);
    };

    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const metadata = JSON.parse(event.data);
        if (metadata.type === 'file-metadata') {
          fileMetadataRef.current = metadata;
          receivedBuffersRef.current = [];
          receivedSizeRef.current = 0;
          setIsReceiving(true);
          setProgress(0);
          addStatus(`Receiving file: ${metadata.name} (${formatBytes(metadata.size)})`, 'info');
        } else if (metadata.type === 'file-end') {
          receiveFile();
        }
      } else {
        receivedBuffersRef.current.push(event.data);
        receivedSizeRef.current += event.data.byteLength;

        if (fileMetadataRef.current) {
          const percent = Math.round((receivedSizeRef.current / fileMetadataRef.current.size) * 100);
          setProgress(percent);
        }
      }
    };
  };

  const receiveFile = () => {
    const blob = new Blob(receivedBuffersRef.current, { type: fileMetadataRef.current.mimeType });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = fileMetadataRef.current.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    addStatus(`File received: ${fileMetadataRef.current.name}`, 'success');
    setIsReceiving(false);
    setProgress(0);

    receivedBuffersRef.current = [];
    receivedSizeRef.current = 0;
    fileMetadataRef.current = null;
  };

  const sendFile = async () => {
    const file = fileInputRef.current?.files[0];
    if (!file) {
      addStatus('Please select a file', 'error');
      return;
    }

    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') {
      addStatus('Not connected to peer', 'error');
      return;
    }

    addStatus(`Sending file: ${file.name} (${formatBytes(file.size)})`, 'info');
    setProgress(0);

    const metadata = {
      type: 'file-metadata',
      name: file.name,
      size: file.size,
      mimeType: file.type
    };
    dataChannelRef.current.send(JSON.stringify(metadata));

    let offset = 0;
    const reader = new FileReader();

    reader.onload = (e) => {
      dataChannelRef.current.send(e.target.result);
      offset += e.target.result.byteLength;

      const percent = Math.round((offset / file.size) * 100);
      setProgress(percent);

      if (offset < file.size) {
        readSlice(offset);
      } else {
        dataChannelRef.current.send(JSON.stringify({ type: 'file-end' }));
        addStatus('File sent successfully!', 'success');
        setTimeout(() => setProgress(0), 2000);
      }
    };

    const readSlice = (o) => {
      const slice = file.slice(o, o + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    readSlice(0);
  };

  const closePeerConnection = () => {
    dataChannelRef.current?.close();
    peerConnectionRef.current?.close();
    dataChannelRef.current = null;
    peerConnectionRef.current = null;
    setConnectedPeer(null);
    setProgress(0);
    setIsReceiving(false);
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 to-blue-600 p-4">
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-2xl p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">🚀 WebRTC File Transfer</h1>
          <div className="bg-blue-50 rounded-lg p-4">
            <span className="text-sm text-gray-600">Your ID: </span>
            <span className="font-mono font-bold text-blue-600">{myId || 'Connecting...'}</span>
          </div>
        </div>

        <div className="mb-6 space-y-2">
          {status.map(s => (
            <div
              key={s.id}
              className={`p-3 rounded-lg text-sm ${s.type === 'success' ? 'bg-green-100 text-green-800' :
                  s.type === 'error' ? 'bg-red-100 text-red-800' :
                    'bg-blue-100 text-blue-800'
                }`}
            >
              {s.message}
            </div>
          ))}
        </div>

        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-700 mb-4">📡 Available Peers</h2>
          <div className="space-y-2">
            {peers.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                No peers online. Open this page in another tab/browser!
              </div>
            ) : (
              peers.map(peerId => (
                <div
                  key={peerId}
                  className={`flex items-center justify-between p-4 rounded-lg border-2 ${connectedPeer === peerId
                      ? 'bg-green-50 border-green-500'
                      : 'bg-gray-50 border-transparent'
                    }`}
                >
                  <span className="font-mono text-sm text-gray-600">{peerId}</span>
                  <button
                    onClick={() => connectToPeer(peerId)}
                    disabled={connectedPeer !== null}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
                  >
                    {connectedPeer === peerId ? 'Connected' : 'Connect'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {connectedPeer && (
          <div className="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">📤 Send File</h2>
            <p className="text-sm text-gray-600 mb-4">
              Connected to: <strong>{connectedPeer.substring(0, 16)}...</strong>
            </p>

            <input
              ref={fileInputRef}
              type="file"
              className="block w-full text-sm text-gray-600 mb-4
                file:mr-4 file:py-2 file:px-4
                file:rounded-lg file:border-0
                file:text-sm file:font-semibold
                file:bg-purple-600 file:text-white
                hover:file:bg-purple-700
                file:cursor-pointer cursor-pointer"
            />

            <button
              onClick={sendFile}
              className="w-full py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 transition"
            >
              Send File
            </button>

            {(progress > 0 || isReceiving) && (
              <div className="mt-4">
                <div className="bg-gray-200 rounded-full h-6 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-purple-600 to-blue-600 h-full transition-all duration-300 flex items-center justify-center text-white text-xs font-bold"
                    style={{ width: `${progress}%` }}
                  >
                    {progress}%
                  </div>
                </div>
                <p className="text-center text-sm text-gray-600 mt-2">
                  {isReceiving ? 'Receiving...' : 'Sending...'}
                </p>
              </div>
            )}

            <button
              onClick={closePeerConnection}
              className="w-full mt-4 py-2 bg-red-500 text-white rounded-lg font-semibold hover:bg-red-600 transition"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    </div>
  );
}