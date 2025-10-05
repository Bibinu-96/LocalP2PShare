import { useState, useEffect, useRef } from 'react';

const CHUNK_SIZE = 16384;

export default function App() {
  const [myId, setMyId] = useState('');
  const [remoteId, setRemoteId] = useState('');
  const [connectedPeer, setConnectedPeer] = useState(null);
  const [status, setStatus] = useState([]);
  const [progress, setProgress] = useState(0);
  const [isReceiving, setIsReceiving] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');

  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const fileInputRef = useRef(null);

  const receivedBuffersRef = useRef([]);
  const receivedSizeRef = useRef(0);
  const fileMetadataRef = useRef(null);

  useEffect(() => {
    // Generate a random ID for this peer
    const id = 'peer-' + Math.random().toString(36).substr(2, 9);
    setMyId(id);
    addStatus('Ready to connect. Share your ID with a peer.', 'info');
  }, []);

  const addStatus = (message, type = 'info') => {
    const newStatus = { id: Date.now(), message, type };
    setStatus(prev => [...prev, newStatus]);
    setTimeout(() => {
      setStatus(prev => prev.filter(s => s.id !== newStatus.id));
    }, 5000);
  };

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
      setConnectionStatus(pc.iceConnectionState);
      
      if (pc.iceConnectionState === 'connected') {
        addStatus('Connected successfully!', 'success');
      } else if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        addStatus('Connection lost', 'error');
        closePeerConnection();
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('New ICE candidate:', event.candidate);
      }
    };

    return pc;
  };

  const createOffer = async () => {
    if (peerConnectionRef.current) {
      addStatus('Already have a connection', 'error');
      return;
    }

    try {
      addStatus('Creating offer...', 'info');
      peerConnectionRef.current = createPeerConnection();

      // Create data channel
      dataChannelRef.current = peerConnectionRef.current.createDataChannel('fileTransfer');
      setupDataChannel(dataChannelRef.current);

      const offer = await peerConnectionRef.current.createOffer();
      await peerConnectionRef.current.setLocalDescription(offer);

      // Wait for ICE gathering to complete
      await new Promise((resolve) => {
        if (peerConnectionRef.current.iceGatheringState === 'complete') {
          resolve();
        } else {
          peerConnectionRef.current.addEventListener('icegatheringstatechange', () => {
            if (peerConnectionRef.current.iceGatheringState === 'complete') {
              resolve();
            }
          });
        }
      });

      const offerData = JSON.stringify(peerConnectionRef.current.localDescription);
      
      // Copy to clipboard
      await navigator.clipboard.writeText(offerData);
      addStatus('Offer copied to clipboard! Send it to your peer.', 'success');
      console.log('Offer created:', offerData);
    } catch (error) {
      console.error('Error creating offer:', error);
      addStatus('Error creating offer: ' + error.message, 'error');
    }
  };

  const handleOffer = async (offerText) => {
    if (peerConnectionRef.current) {
      addStatus('Already have a connection', 'error');
      return;
    }

    try {
      addStatus('Processing offer...', 'info');
      const offer = JSON.parse(offerText);
      
      peerConnectionRef.current = createPeerConnection();

      // Set up data channel listener
      peerConnectionRef.current.ondatachannel = (event) => {
        dataChannelRef.current = event.channel;
        setupDataChannel(dataChannelRef.current);
      };

      await peerConnectionRef.current.setRemoteDescription(offer);
      const answer = await peerConnectionRef.current.createAnswer();
      await peerConnectionRef.current.setLocalDescription(answer);

      // Wait for ICE gathering
      await new Promise((resolve) => {
        if (peerConnectionRef.current.iceGatheringState === 'complete') {
          resolve();
        } else {
          peerConnectionRef.current.addEventListener('icegatheringstatechange', () => {
            if (peerConnectionRef.current.iceGatheringState === 'complete') {
              resolve();
            }
          });
        }
      });

      const answerData = JSON.stringify(peerConnectionRef.current.localDescription);
      
      // Copy to clipboard
      await navigator.clipboard.writeText(answerData);
      addStatus('Answer copied to clipboard! Send it back to your peer.', 'success');
      console.log('Answer created:', answerData);
    } catch (error) {
      console.error('Error handling offer:', error);
      addStatus('Error processing offer: ' + error.message, 'error');
    }
  };

  const handleAnswer = async (answerText) => {
    if (!peerConnectionRef.current) {
      addStatus('No offer created yet. Create an offer first.', 'error');
      return;
    }

    try {
      addStatus('Processing answer...', 'info');
      const answer = JSON.parse(answerText);
      await peerConnectionRef.current.setRemoteDescription(answer);
      addStatus('Connection established!', 'success');
      setConnectedPeer('Remote Peer');
    } catch (error) {
      console.error('Error handling answer:', error);
      addStatus('Error processing answer: ' + error.message, 'error');
    }
  };

  const setupDataChannel = (channel) => {
    channel.binaryType = 'arraybuffer';
    
    channel.onopen = () => {
      addStatus('Data channel opened! You can now send files.', 'success');
      setConnectedPeer('Remote Peer');
    };
    
    channel.onclose = () => {
      addStatus('Data channel closed', 'info');
      closePeerConnection();
    };
    
    channel.onerror = (error) => {
      addStatus('Data channel error', 'error');
      console.error('Data channel error:', error);
    };
    
    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const metadata = JSON.parse(event.data);
          
          if (metadata.type === 'file-metadata') {
            fileMetadataRef.current = metadata;
            receivedBuffersRef.current = [];
            receivedSizeRef.current = 0;
            setIsReceiving(true);
            setProgress(0);
            addStatus(`Receiving file: ${metadata.name} (${formatBytes(metadata.size)})`, 'info');
            console.log('File metadata received:', metadata);
          } else if (metadata.type === 'file-end') {
            console.log('File transfer complete signal received');
            receiveFile();
          }
        } catch (error) {
          console.error('Error parsing metadata:', error);
          addStatus('Error: Invalid file metadata', 'error');
        }
        return;
      }
      
      if (event.data instanceof ArrayBuffer) {
        if (!fileMetadataRef.current) {
          console.error('Received file chunk before metadata');
          addStatus('Error: Received data before file information', 'error');
          return;
        }
        
        receivedBuffersRef.current.push(event.data);
        receivedSizeRef.current += event.data.byteLength;
        
        const percent = Math.round((receivedSizeRef.current / fileMetadataRef.current.size) * 100);
        setProgress(percent);
        console.log(`Receiving: ${percent}% (${receivedSizeRef.current}/${fileMetadataRef.current.size} bytes)`);
      }
    };
  };

  const receiveFile = () => {
    if (!fileMetadataRef.current) {
      console.error('File metadata is missing');
      addStatus('Error: File metadata not received', 'error');
      receivedBuffersRef.current = [];
      receivedSizeRef.current = 0;
      setIsReceiving(false);
      setProgress(0);
      return;
    }

    if (!receivedBuffersRef.current || receivedBuffersRef.current.length === 0) {
      console.error('No file data received');
      addStatus('Error: No file data received', 'error');
      fileMetadataRef.current = null;
      setIsReceiving(false);
      setProgress(0);
      return;
    }

    try {
      const blob = new Blob(receivedBuffersRef.current, { type: fileMetadataRef.current.type });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = fileMetadataRef.current.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      addStatus(`File received: ${fileMetadataRef.current.name}`, 'success');
      console.log('File download triggered successfully');
    } catch (error) {
      console.error('Error creating file:', error);
      addStatus(`Error saving file: ${error.message}`, 'error');
    } finally {
      setIsReceiving(false);
      setProgress(0);
      receivedBuffersRef.current = [];
      receivedSizeRef.current = 0;
      fileMetadataRef.current = null;
    }
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
      type: file.type
    };
    dataChannelRef.current.send(JSON.stringify(metadata));
    console.log('Sent file metadata:', metadata);

    let offset = 0;
    const reader = new FileReader();

    reader.onload = (e) => {
      dataChannelRef.current.send(e.target.result);
      offset += e.target.result.byteLength;

      const percent = Math.round((offset / file.size) * 100);
      setProgress(percent);
      console.log(`Sending: ${percent}% (${offset}/${file.size} bytes)`);

      if (offset < file.size) {
        readSlice(offset);
      } else {
        dataChannelRef.current.send(JSON.stringify({ type: 'file-end' }));
        addStatus('File sent successfully!', 'success');
        console.log('File transfer complete');
        setTimeout(() => setProgress(0), 2000);
      }
    };

    reader.onerror = (error) => {
      console.error('FileReader error:', error);
      addStatus('Error reading file', 'error');
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
    setConnectionStatus('disconnected');
    setProgress(0);
    setIsReceiving(false);
    receivedBuffersRef.current = [];
    receivedSizeRef.current = 0;
    fileMetadataRef.current = null;
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
          <h1 className="text-3xl font-bold text-gray-800 mb-2">🚀 WebRTC P2P File Transfer</h1>
          <p className="text-sm text-gray-600 mb-4">No server needed - direct peer-to-peer connection</p>
          <div className="bg-blue-50 rounded-lg p-4">
            <span className="text-sm text-gray-600">Your ID: </span>
            <span className="font-mono font-bold text-blue-600">{myId}</span>
            {connectionStatus !== 'disconnected' && (
              <div className="mt-2">
                <span className="text-sm text-gray-600">Status: </span>
                <span className={`font-semibold ${
                  connectionStatus === 'connected' ? 'text-green-600' : 
                  connectionStatus === 'connecting' ? 'text-yellow-600' : 'text-red-600'
                }`}>
                  {connectionStatus}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="mb-6 space-y-2">
          {status.map(s => (
            <div
              key={s.id}
              className={`p-3 rounded-lg text-sm ${
                s.type === 'success' ? 'bg-green-100 text-green-800' :
                s.type === 'error' ? 'bg-red-100 text-red-800' :
                'bg-blue-100 text-blue-800'
              }`}
            >
              {s.message}
            </div>
          ))}
        </div>

        {!connectedPeer && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-purple-50 to-blue-50 border-2 border-purple-200 rounded-lg p-6">
              <h2 className="text-xl font-semibold text-gray-700 mb-4">📤 Step 1: Create Connection</h2>
              <button
                onClick={createOffer}
                className="w-full py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 transition"
              >
                Create Offer (Start Connection)
              </button>
              <p className="text-xs text-gray-500 mt-2">
                Click to generate an offer. It will be copied to your clipboard automatically.
              </p>
            </div>

            <div className="bg-gradient-to-r from-green-50 to-teal-50 border-2 border-green-200 rounded-lg p-6">
              <h2 className="text-xl font-semibold text-gray-700 mb-4">📥 Step 2: Exchange Signals</h2>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Received an Offer? Paste it here:
                </label>
                <textarea
                  placeholder="Paste offer JSON here..."
                  className="w-full p-3 border-2 border-gray-300 rounded-lg text-sm font-mono"
                  rows="4"
                  onChange={(e) => setRemoteId(e.target.value)}
                />
                <button
                  onClick={() => handleOffer(remoteId)}
                  className="w-full mt-2 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition"
                >
                  Process Offer & Generate Answer
                </button>
              </div>

              <div className="border-t-2 border-gray-200 pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Received an Answer? Paste it here:
                </label>
                <textarea
                  placeholder="Paste answer JSON here..."
                  className="w-full p-3 border-2 border-gray-300 rounded-lg text-sm font-mono"
                  rows="4"
                  onChange={(e) => setRemoteId(e.target.value)}
                />
                <button
                  onClick={() => handleAnswer(remoteId)}
                  className="w-full mt-2 py-2 bg-teal-600 text-white rounded-lg font-semibold hover:bg-teal-700 transition"
                >
                  Connect with Answer
                </button>
              </div>
            </div>

            <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4">
              <h3 className="font-semibold text-gray-700 mb-2">📝 How to Connect:</h3>
              <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
                <li>One peer clicks "Create Offer" and shares the copied text</li>
                <li>Other peer pastes the offer and clicks "Process Offer"</li>
                <li>Second peer shares the generated answer back</li>
                <li>First peer pastes the answer and clicks "Connect"</li>
                <li>Connection established - start transferring files!</li>
              </ol>
            </div>
          </div>
        )}

        {connectedPeer && (
          <div className="bg-green-50 border-2 border-green-400 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">📤 Send File</h2>
            <p className="text-sm text-gray-600 mb-4">
              Connected to: <strong>{connectedPeer}</strong>
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